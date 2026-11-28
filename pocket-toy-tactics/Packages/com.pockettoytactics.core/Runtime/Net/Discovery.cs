using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace PocketToyTactics.Core.Net
{
    /// <summary>
    /// Short human-friendly code for joining without discovery: encodes the host's IPv4 address (and port
    /// when not the default) in Crockford base32. 7 characters for the default port, e.g. "3G0-M1KQ".
    /// </summary>
    public static class JoinCode
    {
        private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        public static string Encode(IPAddress address, int port = Protocol.DefaultGamePort)
        {
            var ip = address.GetAddressBytes();
            if (ip.Length != 4) throw new ArgumentException("IPv4 only");
            ulong v = ((ulong)ip[0] << 24) | ((ulong)ip[1] << 16) | ((ulong)ip[2] << 8) | ip[3];
            int bits = 32;
            if (port != Protocol.DefaultGamePort) { v = (v << 16) | (uint)port; bits = 48; }
            int chars = bits == 32 ? 7 : 10;
            var sb = new StringBuilder();
            for (int i = chars - 1; i >= 0; i--) sb.Append(Alphabet[(int)((v >> (5 * i)) & 31)]);
            var s = sb.ToString();
            return s.Substring(0, 3) + "-" + s.Substring(3);
        }

        public static bool TryDecode(string code, out IPAddress address, out int port)
        {
            address = null;
            port = Protocol.DefaultGamePort;
            if (code == null) return false;
            var clean = code.Replace("-", "").Replace(" ", "").ToUpperInvariant().Replace('O', '0').Replace('I', '1').Replace('L', '1');
            if (clean.Length != 7 && clean.Length != 10) return false;
            ulong v = 0;
            foreach (char c in clean)
            {
                int d = Alphabet.IndexOf(c);
                if (d < 0) return false;
                v = (v << 5) | (uint)d;
            }
            if (clean.Length == 10) { port = (int)(v & 0xFFFF); v >>= 16; }
            if (v > uint.MaxValue) return false;
            address = new IPAddress(new[] { (byte)(v >> 24), (byte)(v >> 16), (byte)(v >> 8), (byte)v });
            return true;
        }
    }

    public sealed class DiscoveredHost
    {
        public string Name;
        public string SessionId;
        public string TerrainId;
        public IPAddress Address;
        public int Port;
        public string Code;
        public double LastSeen;
    }

    public static class LocalNetwork
    {
        /// <summary>Usable IPv4 addresses of this device (Wi-Fi, hotspot), most likely LAN address first.</summary>
        public static List<IPAddress> LocalIPv4()
        {
            var result = new List<IPAddress>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                        if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address))
                            result.Add(ua.Address);
                }
            }
            catch (Exception) { /* some mobile runtimes restrict interface enumeration */ }
            result.Sort((a, b) => Score(b).CompareTo(Score(a)));
            return result;
        }

        private static int Score(IPAddress a)
        {
            var b = a.GetAddressBytes();
            if (b[0] == 192 && b[1] == 168) return 3;
            if (b[0] == 10) return 2;
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return 2;
            if (b[0] == 169 && b[1] == 254) return 0;
            return 1;
        }

        /// <summary>Broadcast targets: limited broadcast plus each interface's directed broadcast.</summary>
        public static List<IPEndPoint> BroadcastTargets(int port)
        {
            var list = new List<IPEndPoint> { new IPEndPoint(IPAddress.Broadcast, port) };
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork || ua.IPv4Mask == null) continue;
                        var ip = ua.Address.GetAddressBytes();
                        var mask = ua.IPv4Mask.GetAddressBytes();
                        var bc = new byte[4];
                        for (int i = 0; i < 4; i++) bc[i] = (byte)(ip[i] | ~mask[i]);
                        list.Add(new IPEndPoint(new IPAddress(bc), port));
                    }
                }
            }
            catch (Exception) { }
            return list;
        }
    }

    /// <summary>
    /// Host side of LAN discovery: broadcasts a small UDP beacon every second.
    /// Android note: no permission is needed to send; the browsing device needs a Wi-Fi MulticastLock.
    /// </summary>
    public sealed class DiscoveryBeacon : IDisposable
    {
        private readonly UdpClient _udp;
        private readonly byte[] _payload;
        private readonly List<IPEndPoint> _targets;
        private volatile bool _running = true;

        public DiscoveryBeacon(string hostName, string sessionId, string terrainId, int gamePort, string code,
                               int discoveryPort = Protocol.DiscoveryPort, List<IPEndPoint> extraTargets = null)
        {
            _udp = new UdpClient(AddressFamily.InterNetwork) { EnableBroadcast = true };
            var body = new Dictionary<string, object>
            {
                ["magic"] = "PTT", ["v"] = Protocol.Version, ["name"] = hostName, ["session"] = sessionId,
                ["terrain"] = terrainId, ["port"] = gamePort, ["code"] = code,
            };
            _payload = Encoding.UTF8.GetBytes(Json.Write(body));
            _targets = LocalNetwork.BroadcastTargets(discoveryPort);
            if (extraTargets != null) _targets.AddRange(extraTargets);
            new Thread(Loop) { IsBackground = true, Name = "ptt-beacon" }.Start();
        }

        private void Loop()
        {
            while (_running)
            {
                foreach (var t in _targets)
                {
                    try { _udp.Send(_payload, _payload.Length, t); } catch (Exception) { }
                }
                Thread.Sleep(1000);
            }
        }

        public void Dispose()
        {
            _running = false;
            try { _udp.Close(); } catch (Exception) { }
        }
    }

    /// <summary>Client side of LAN discovery: listens for beacons and keeps a list of hosts seen recently.</summary>
    public sealed class DiscoveryBrowser : IDisposable
    {
        private readonly UdpClient _udp;
        private readonly ConcurrentQueue<KeyValuePair<IPEndPoint, string>> _inbox = new ConcurrentQueue<KeyValuePair<IPEndPoint, string>>();
        private readonly Dictionary<string, DiscoveredHost> _hosts = new Dictionary<string, DiscoveredHost>();
        private readonly Func<double> _clock;
        private volatile bool _running = true;
        public int BeaconsReceived { get; private set; }

        public DiscoveryBrowser(Func<double> clock, int discoveryPort = Protocol.DiscoveryPort)
        {
            _clock = clock;
            _udp = new UdpClient(AddressFamily.InterNetwork);
            _udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            _udp.Client.Bind(new IPEndPoint(IPAddress.Any, discoveryPort));
            new Thread(Loop) { IsBackground = true, Name = "ptt-discovery" }.Start();
        }

        private void Loop()
        {
            while (_running)
            {
                try
                {
                    var from = new IPEndPoint(IPAddress.Any, 0);
                    var data = _udp.Receive(ref from);
                    _inbox.Enqueue(new KeyValuePair<IPEndPoint, string>(from, Encoding.UTF8.GetString(data)));
                }
                catch (Exception) { if (!_running) return; }
            }
        }

        /// <summary>Hosts heard during the last <paramref name="maxAge"/> seconds.</summary>
        public List<DiscoveredHost> Poll(double maxAge = 4)
        {
            double now = _clock();
            while (_inbox.TryDequeue(out var kv))
            {
                try
                {
                    var d = Json.ParseObject(kv.Value);
                    if (d.Str("magic") != "PTT" || d.Int("v") != Protocol.Version) continue;
                    BeaconsReceived++;
                    var session = d.Str("session");
                    if (!_hosts.TryGetValue(session, out var h)) _hosts[session] = h = new DiscoveredHost();
                    h.Name = d.Str("name");
                    h.SessionId = session;
                    h.TerrainId = d.Str("terrain");
                    h.Address = kv.Key.Address;
                    h.Port = d.Int("port");
                    h.Code = d.Str("code");
                    h.LastSeen = now;
                }
                catch (Exception) { /* not ours */ }
            }
            var list = new List<DiscoveredHost>();
            foreach (var h in _hosts.Values) if (now - h.LastSeen <= maxAge) list.Add(h);
            return list;
        }

        public void Dispose()
        {
            _running = false;
            try { _udp.Close(); } catch (Exception) { }
        }
    }
}
