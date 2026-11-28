using System;
using System.Collections.Generic;

namespace PocketToyTactics.Core.Net
{
    /// <summary>Wire protocol constants and message builders. Every message is one JSON object with a "type".</summary>
    public static class Protocol
    {
        public const int Version = 1;
        public const int DiscoveryPort = 47777;
        public const int DefaultGamePort = 47778;
        public const double PingInterval = 1.0;
        public const double Timeout = 6.0;

        // Message types
        public const string Hello = "hello";         // client -> host: {v, name, session?, lastSeq}
        public const string Welcome = "welcome";     // host -> client: {session, side, hostName, seq, view}
        public const string Refused = "refused";     // host -> client: {reason}
        public const string Intent = "intent";       // client -> host: {aid, cmd}
        public const string Rejected = "rejected";   // host -> client: {aid, error}
        public const string Update = "update";       // host -> client: {seq, aid?, events, view}
        public const string Resync = "resync";       // client -> host: {} -> host answers with welcome
        public const string Ping = "ping";
        public const string Pong = "pong";
        public const string Bye = "bye";

        public static string Msg(string type, Dictionary<string, object> body = null)
        {
            body = body ?? new Dictionary<string, object>();
            body["type"] = type;
            return Json.Write(body);
        }

        internal static List<object> EventsJson(IEnumerable<GameEvent> events, Side viewer)
        {
            var l = new List<object>();
            foreach (var e in events) l.Add(e.RedactFor(viewer).ToJson());
            return l;
        }

        internal static List<GameEvent> EventsFromJson(List<object> l)
        {
            var r = new List<GameEvent>();
            if (l != null) foreach (Dictionary<string, object> d in l) r.Add(GameEvent.FromJson(d));
            return r;
        }
    }

    public enum PeerStatus { WaitingForPeer, Connected, Disconnected }

    /// <summary>
    /// Host-authoritative game session. The host device owns the only complete GameState; the client sends
    /// intents, the host validates them with the RulesEngine, applies them, and sends back the resulting
    /// events and a redacted PlayerView. Duplicate intents (same action id) are answered idempotently.
    /// Call Poll() every frame from the main thread.
    /// </summary>
    public sealed class HostSession
    {
        private readonly RulesEngine _engine;
        private readonly Func<double> _clock;
        private readonly Dictionary<string, long> _processed = new Dictionary<string, long>();
        private readonly Dictionary<string, RuleError> _rejected = new Dictionary<string, RuleError>();
        private IConnection _peer;
        private double _lastHeard, _lastPing;
        private List<GameEvent> _lastClientEvents = new List<GameEvent>();

        public GameState State { get; private set; }
        public Side HostSide { get; }
        public Side ClientSide => HostSide.Other();
        public string SessionId { get; }
        public string HostName { get; }
        public string ClientName { get; private set; }
        public PeerStatus Status { get; private set; } = PeerStatus.WaitingForPeer;
        public readonly List<string> Log = new List<string>();

        /// <summary>Raised with host-side events and view after every applied command (local or remote).</summary>
        public event Action<List<GameEvent>, PlayerView> Updated;
        public event Action<PeerStatus> StatusChanged;

        public HostSession(RulesEngine engine, GameState state, Side hostSide, string sessionId, string hostName, Func<double> clock)
        {
            _engine = engine;
            State = state;
            HostSide = hostSide;
            SessionId = sessionId;
            HostName = hostName;
            _clock = clock;
        }

        public PlayerView HostView => PlayerView.Create(State, HostSide);

        /// <summary>Hands a newly accepted connection to the session (first join or reconnection).</summary>
        public void Accept(IConnection connection)
        {
            if (_peer != null && _peer.IsConnected && _peer != connection) _peer.Close();
            _peer = connection;
            _lastHeard = _clock();
            Log.Add("connection from " + connection.RemoteDescription);
        }

        /// <summary>The host player's own action.</summary>
        public ApplyResult SubmitLocal(Command c)
        {
            if (c.Player != HostSide) return new ApplyResult { Error = RuleError.NotYourTurn };
            return ApplyAndBroadcast(c, null);
        }

        private ApplyResult ApplyAndBroadcast(Command c, string actionId)
        {
            var r = _engine.Apply(State, c);
            if (!r.Ok) return r;
            if (actionId != null) _processed[actionId] = State.Seq;
            _lastClientEvents = r.Events;
            SendUpdate(actionId, r.Events);
            var hostEvents = r.Events.ConvertAll(e => e.RedactFor(HostSide));
            Updated?.Invoke(hostEvents, HostView);
            return r;
        }

        private void SendUpdate(string actionId, List<GameEvent> events)
        {
            if (_peer == null || !_peer.IsConnected) return;
            _peer.Send(Protocol.Msg(Protocol.Update, new Dictionary<string, object>
            {
                ["seq"] = State.Seq,
                ["aid"] = actionId,
                ["events"] = Protocol.EventsJson(events, ClientSide),
                ["view"] = PlayerView.Create(State, ClientSide).ToJson(),
            }));
        }

        private void SendWelcome()
        {
            _peer.Send(Protocol.Msg(Protocol.Welcome, new Dictionary<string, object>
            {
                ["session"] = SessionId,
                ["side"] = ClientSide.Key(),
                ["hostName"] = HostName,
                ["seq"] = State.Seq,
                ["view"] = PlayerView.Create(State, ClientSide).ToJson(),
            }));
        }

        private void SetStatus(PeerStatus s)
        {
            if (Status == s) return;
            Status = s;
            Log.Add("peer " + s);
            StatusChanged?.Invoke(s);
        }

        public void Poll()
        {
            if (_peer == null) return;
            double now = _clock();
            while (_peer.TryReceive(out var raw))
            {
                _lastHeard = now;
                Dictionary<string, object> m;
                try { m = Json.ParseObject(raw); }
                catch (Exception) { Log.Add("malformed message ignored"); continue; }
                Handle(m);
            }
            if (Status == PeerStatus.Connected)
            {
                if (now - _lastPing >= Protocol.PingInterval) { _lastPing = now; _peer.Send(Protocol.Msg(Protocol.Ping)); }
                if (!_peer.IsConnected || now - _lastHeard > Protocol.Timeout)
                {
                    _peer.Close();
                    SetStatus(PeerStatus.Disconnected);
                }
            }
        }

        private void Handle(Dictionary<string, object> m)
        {
            switch (m.Str("type"))
            {
                case Protocol.Hello:
                {
                    if (m.Int("v") != Protocol.Version)
                    {
                        _peer.Send(Protocol.Msg(Protocol.Refused, new Dictionary<string, object> { ["reason"] = "version" }));
                        _peer.Close();
                        return;
                    }
                    var session = m.Str("session");
                    if (session != null && session != SessionId)
                    {
                        _peer.Send(Protocol.Msg(Protocol.Refused, new Dictionary<string, object> { ["reason"] = "session" }));
                        _peer.Close();
                        return;
                    }
                    ClientName = m.Str("name", "?");
                    SendWelcome();
                    SetStatus(PeerStatus.Connected);
                    break;
                }
                case Protocol.Resync:
                    SendWelcome();
                    break;
                case Protocol.Ping:
                    _peer.Send(Protocol.Msg(Protocol.Pong));
                    break;
                case Protocol.Pong:
                    break;
                case Protocol.Bye:
                    _peer.Close();
                    SetStatus(PeerStatus.Disconnected);
                    break;
                case Protocol.Intent:
                    HandleIntent(m);
                    break;
                default:
                    Log.Add("unknown message " + m.Str("type"));
                    break;
            }
        }

        private void HandleIntent(Dictionary<string, object> m)
        {
            var aid = m.Str("aid");
            if (string.IsNullOrEmpty(aid)) return;
            if (_processed.TryGetValue(aid, out long seq))
            {
                // Duplicate of an applied intent: never apply twice. Resend the current state so the client converges.
                Log.Add("duplicate intent " + aid + " (seq " + seq + ")");
                SendUpdate(aid, new List<GameEvent>());
                return;
            }
            if (_rejected.TryGetValue(aid, out var prevErr))
            {
                _peer.Send(Protocol.Msg(Protocol.Rejected, new Dictionary<string, object> { ["aid"] = aid, ["error"] = prevErr.ToString() }));
                return;
            }
            Command c;
            try { c = Command.FromJson(m.Obj("cmd")); }
            catch (Exception) { c = null; }
            RuleError err;
            if (c == null) err = RuleError.InvalidCommand;
            else if (c.Player != ClientSide) err = RuleError.NotYourTurn; // a client can only act for its own side
            else
            {
                c.ActionId = aid;
                err = ApplyAndBroadcast(c, aid).Error;
            }
            if (err != RuleError.None)
            {
                _rejected[aid] = err;
                Log.Add("rejected intent " + aid + ": " + err);
                _peer.Send(Protocol.Msg(Protocol.Rejected, new Dictionary<string, object> { ["aid"] = aid, ["error"] = err.ToString() }));
            }
        }

        public void Close()
        {
            if (_peer != null && _peer.IsConnected) { _peer.Send(Protocol.Msg(Protocol.Bye)); _peer.Close(); }
        }
    }

    /// <summary>
    /// Client side of a session. Holds the latest authoritative PlayerView; sends intents with unique ids,
    /// keeps them until the host confirms or rejects them, and resends them after a reconnection.
    /// Updates are ordered by sequence number: older or duplicate updates are ignored, and a gap is healed by
    /// the full view every update carries (animations are skipped for missed steps).
    /// </summary>
    public sealed class ClientSession
    {
        private readonly Func<double> _clock;
        private readonly string _name;
        private readonly List<KeyValuePair<string, Command>> _pending = new List<KeyValuePair<string, Command>>();
        private IConnection _conn;
        private double _lastHeard, _lastPing;
        private int _aidCounter;
        private readonly string _clientId;

        public PlayerView View { get; private set; }
        public Side Side { get; private set; }
        public string SessionId { get; private set; }
        public string HostName { get; private set; }
        public long LastSeq { get; private set; } = -1;
        public PeerStatus Status { get; private set; } = PeerStatus.WaitingForPeer;
        public string RefusedReason { get; private set; }
        public int PendingCount => _pending.Count;
        public readonly List<string> Log = new List<string>();

        /// <summary>(events, view, animate). animate=false when steps were missed and only the snapshot applies.</summary>
        public event Action<List<GameEvent>, PlayerView, bool> Updated;
        public event Action<string, RuleError> Rejected;
        public event Action<PeerStatus> StatusChanged;

        public ClientSession(string playerName, Func<double> clock, string clientId = null)
        {
            _name = playerName;
            _clock = clock;
            _clientId = clientId ?? Guid.NewGuid().ToString("N").Substring(0, 8);
        }

        /// <summary>Starts (or resumes, after a disconnection) the session over a new connection.</summary>
        public void Connect(IConnection connection)
        {
            _conn = connection;
            _lastHeard = _clock();
            var hello = new Dictionary<string, object> { ["v"] = Protocol.Version, ["name"] = _name, ["lastSeq"] = LastSeq };
            if (SessionId != null) hello["session"] = SessionId;
            _conn.Send(Protocol.Msg(Protocol.Hello, hello));
        }

        public string Submit(Command c)
        {
            var aid = _clientId + "-" + (++_aidCounter);
            c = c.Clone();
            c.ActionId = aid;
            _pending.Add(new KeyValuePair<string, Command>(aid, c));
            SendIntent(aid, c);
            return aid;
        }

        private void SendIntent(string aid, Command c)
        {
            if (_conn == null || !_conn.IsConnected) return;
            _conn.Send(Protocol.Msg(Protocol.Intent, new Dictionary<string, object> { ["aid"] = aid, ["cmd"] = c.ToJson() }));
        }

        public void RequestResync()
        {
            _conn?.Send(Protocol.Msg(Protocol.Resync));
        }

        private void SetStatus(PeerStatus s)
        {
            if (Status == s) return;
            Status = s;
            Log.Add("host " + s);
            StatusChanged?.Invoke(s);
        }

        public void Poll()
        {
            if (_conn == null) return;
            double now = _clock();
            while (_conn.TryReceive(out var raw))
            {
                _lastHeard = now;
                Dictionary<string, object> m;
                try { m = Json.ParseObject(raw); }
                catch (Exception) { Log.Add("malformed message ignored"); continue; }
                Handle(m);
            }
            if (Status == PeerStatus.Connected)
            {
                if (now - _lastPing >= Protocol.PingInterval) { _lastPing = now; _conn.Send(Protocol.Msg(Protocol.Ping)); }
                if (!_conn.IsConnected || now - _lastHeard > Protocol.Timeout)
                {
                    _conn.Close();
                    SetStatus(PeerStatus.Disconnected);
                }
            }
        }

        private void Handle(Dictionary<string, object> m)
        {
            switch (m.Str("type"))
            {
                case Protocol.Welcome:
                {
                    SessionId = m.Str("session");
                    Side = SideExt.ParseSide(m.Str("side"));
                    HostName = m.Str("hostName");
                    var view = PlayerView.FromJson(m.Obj("view"));
                    bool resumed = LastSeq >= 0;
                    LastSeq = m.Long("seq");
                    View = view;
                    SetStatus(PeerStatus.Connected);
                    Updated?.Invoke(new List<GameEvent>(), View, false);
                    // Intents not yet confirmed are sent again; the host de-duplicates them by action id.
                    if (resumed) foreach (var kv in _pending.ToArray()) SendIntent(kv.Key, kv.Value);
                    break;
                }
                case Protocol.Refused:
                    RefusedReason = m.Str("reason");
                    _conn.Close();
                    SetStatus(PeerStatus.Disconnected);
                    break;
                case Protocol.Update:
                {
                    long seq = m.Long("seq");
                    var aid = m.Str("aid");
                    if (aid != null) _pending.RemoveAll(kv => kv.Key == aid);
                    if (seq <= LastSeq && !(seq == LastSeq && aid != null)) { Log.Add("stale update " + seq + " ignored"); break; }
                    bool animate = seq == LastSeq + 1;
                    if (seq > LastSeq + 1) Log.Add("gap " + LastSeq + " -> " + seq + ": snapshot applied without animation");
                    LastSeq = seq;
                    View = PlayerView.FromJson(m.Obj("view"));
                    Updated?.Invoke(animate ? Protocol.EventsFromJson(m.Arr("events")) : new List<GameEvent>(), View, animate);
                    break;
                }
                case Protocol.Rejected:
                {
                    var aid = m.Str("aid");
                    _pending.RemoveAll(kv => kv.Key == aid);
                    Enum.TryParse(m.Str("error"), out RuleError err);
                    Rejected?.Invoke(aid, err);
                    break;
                }
                case Protocol.Ping:
                    _conn.Send(Protocol.Msg(Protocol.Pong));
                    break;
                case Protocol.Pong:
                    break;
                case Protocol.Bye:
                    _conn.Close();
                    SetStatus(PeerStatus.Disconnected);
                    break;
            }
        }

        public void Close()
        {
            if (_conn != null && _conn.IsConnected) { _conn.Send(Protocol.Msg(Protocol.Bye)); _conn.Close(); }
        }
    }
}
