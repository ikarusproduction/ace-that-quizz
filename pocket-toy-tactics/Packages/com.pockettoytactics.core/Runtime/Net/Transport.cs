using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace PocketToyTactics.Core.Net
{
    /// <summary>
    /// A reliable, ordered, message-based link between the two devices. TCP implements it for Wi-Fi /
    /// hotspot play; a Bluetooth bridge (native Android/iOS plugin) must implement the same interface.
    /// All methods are safe to call from the game's main thread; receiving happens in the background.
    /// </summary>
    public interface IConnection
    {
        bool IsConnected { get; }
        string RemoteDescription { get; }
        void Send(string message);
        bool TryReceive(out string message);
        void Close();
    }

    /// <summary>Length-prefixed UTF-8 frames (4-byte big-endian length).</summary>
    public static class Framing
    {
        public const int MaxFrame = 4 * 1024 * 1024;

        public static void Write(Stream s, string message)
        {
            var payload = Encoding.UTF8.GetBytes(message);
            var header = new byte[4];
            header[0] = (byte)(payload.Length >> 24);
            header[1] = (byte)(payload.Length >> 16);
            header[2] = (byte)(payload.Length >> 8);
            header[3] = (byte)payload.Length;
            s.Write(header, 0, 4);
            s.Write(payload, 0, payload.Length);
            s.Flush();
        }

        /// <summary>Returns null on a clean end of stream.</summary>
        public static string Read(Stream s)
        {
            var header = new byte[4];
            if (!ReadExactly(s, header, 4)) return null;
            int len = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];
            if (len < 0 || len > MaxFrame) throw new IOException("Invalid frame length " + len);
            var payload = new byte[len];
            if (!ReadExactly(s, payload, len)) throw new IOException("Connection closed mid-frame");
            return Encoding.UTF8.GetString(payload);
        }

        private static bool ReadExactly(Stream s, byte[] buf, int n)
        {
            int off = 0;
            while (off < n)
            {
                int r = s.Read(buf, off, n - off);
                if (r <= 0)
                {
                    if (off == 0) return false;
                    throw new IOException("Connection closed mid-frame");
                }
                off += r;
            }
            return true;
        }
    }

    public sealed class TcpConnection : IConnection
    {
        private readonly TcpClient _client;
        private readonly NetworkStream _stream;
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private readonly object _sendLock = new object();
        private volatile bool _connected = true;

        public TcpConnection(TcpClient client)
        {
            _client = client;
            _client.NoDelay = true;
            _stream = client.GetStream();
            RemoteDescription = client.Client.RemoteEndPoint?.ToString() ?? "?";
            var t = new Thread(ReadLoop) { IsBackground = true, Name = "ptt-tcp-read" };
            t.Start();
        }

        public static TcpConnection Connect(string host, int port, int timeoutMs = 5000)
        {
            var client = new TcpClient(AddressFamily.InterNetwork);
            var task = client.ConnectAsync(host, port);
            if (!task.Wait(timeoutMs) || !client.Connected)
            {
                client.Close();
                throw new IOException("Could not connect to " + host + ":" + port);
            }
            return new TcpConnection(client);
        }

        public bool IsConnected => _connected;
        public string RemoteDescription { get; }

        private void ReadLoop()
        {
            try
            {
                while (_connected)
                {
                    var m = Framing.Read(_stream);
                    if (m == null) break;
                    _inbox.Enqueue(m);
                }
            }
            catch (Exception) { /* connection lost */ }
            _connected = false;
        }

        public void Send(string message)
        {
            if (!_connected) return;
            try
            {
                lock (_sendLock) Framing.Write(_stream, message);
            }
            catch (Exception) { _connected = false; }
        }

        public bool TryReceive(out string message) => _inbox.TryDequeue(out message);

        public void Close()
        {
            _connected = false;
            try { _client.Close(); } catch (Exception) { }
        }
    }

    /// <summary>Accepts TCP connections in the background (host side).</summary>
    public sealed class TcpHostListener : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly ConcurrentQueue<IConnection> _accepted = new ConcurrentQueue<IConnection>();
        private volatile bool _running = true;

        public int Port { get; }

        public TcpHostListener(int port)
        {
            _listener = new TcpListener(IPAddress.Any, port);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            new Thread(AcceptLoop) { IsBackground = true, Name = "ptt-tcp-accept" }.Start();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                try { _accepted.Enqueue(new TcpConnection(_listener.AcceptTcpClient())); }
                catch (Exception) { if (!_running) return; Thread.Sleep(50); }
            }
        }

        public bool TryAccept(out IConnection connection) => _accepted.TryDequeue(out connection);

        public void Dispose()
        {
            _running = false;
            try { _listener.Stop(); } catch (Exception) { }
        }
    }

    /// <summary>In-memory connection pair, used by tests to simulate loss, duplication and reordering.</summary>
    public sealed class MemoryConnection : IConnection
    {
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private MemoryConnection _peer;
        private volatile bool _connected = true;

        public static void CreatePair(out MemoryConnection a, out MemoryConnection b)
        {
            a = new MemoryConnection();
            b = new MemoryConnection();
            a._peer = b;
            b._peer = a;
        }

        public bool IsConnected => _connected;
        public string RemoteDescription => "memory";
        /// <summary>When set, outgoing messages are passed through this filter (return null to drop).</summary>
        public Func<string, string> OutgoingFilter;

        public void Send(string message)
        {
            if (!_connected || !_peer._connected) return;
            var m = OutgoingFilter != null ? OutgoingFilter(message) : message;
            if (m != null) _peer._inbox.Enqueue(m);
        }

        /// <summary>Injects a raw message as if it came from the peer.</summary>
        public void Inject(string message) => _inbox.Enqueue(message);

        public bool TryReceive(out string message) => _inbox.TryDequeue(out message);

        public void Close()
        {
            _connected = false;
            if (_peer != null) _peer._connected = false;
        }
    }
}
