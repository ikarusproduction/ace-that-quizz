using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace PocketToyTactics.Core
{
    /// <summary>
    /// Minimal dependency-free JSON reader/writer. Unity ships no System.Text.Json by default,
    /// and JsonUtility cannot read dictionaries or polymorphic data, so the core carries its own.
    /// Parsed values are: Dictionary&lt;string, object&gt;, List&lt;object&gt;, string, double, bool, null.
    /// </summary>
    public static class Json
    {
        public static object Parse(string text)
        {
            if (text == null) throw new ArgumentNullException(nameof(text));
            var p = new Parser(text);
            p.SkipWs();
            var v = p.ReadValue();
            p.SkipWs();
            if (!p.End) throw new FormatException("Trailing characters in JSON at " + p.Pos);
            return v;
        }

        public static Dictionary<string, object> ParseObject(string text)
        {
            return Parse(text) as Dictionary<string, object>
                   ?? throw new FormatException("JSON root is not an object");
        }

        private sealed class Parser
        {
            private readonly string _s;
            public int Pos;
            public Parser(string s) { _s = s; }
            public bool End => Pos >= _s.Length;

            public void SkipWs()
            {
                while (Pos < _s.Length && char.IsWhiteSpace(_s[Pos])) Pos++;
            }

            private char Peek() => Pos < _s.Length ? _s[Pos] : '\0';

            private void Expect(char c)
            {
                if (Peek() != c) throw new FormatException("Expected '" + c + "' at " + Pos);
                Pos++;
            }

            public object ReadValue()
            {
                SkipWs();
                char c = Peek();
                switch (c)
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': ReadWord("true"); return true;
                    case 'f': ReadWord("false"); return false;
                    case 'n': ReadWord("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw new FormatException("Unexpected character '" + c + "' at " + Pos);
                }
            }

            private void ReadWord(string w)
            {
                if (string.CompareOrdinal(_s, Pos, w, 0, w.Length) != 0) throw new FormatException("Expected " + w + " at " + Pos);
                Pos += w.Length;
            }

            private Dictionary<string, object> ReadObject()
            {
                var d = new Dictionary<string, object>();
                Expect('{');
                SkipWs();
                if (Peek() == '}') { Pos++; return d; }
                while (true)
                {
                    SkipWs();
                    string k = ReadString();
                    SkipWs();
                    Expect(':');
                    d[k] = ReadValue();
                    SkipWs();
                    if (Peek() == ',') { Pos++; continue; }
                    Expect('}');
                    return d;
                }
            }

            private List<object> ReadArray()
            {
                var l = new List<object>();
                Expect('[');
                SkipWs();
                if (Peek() == ']') { Pos++; return l; }
                while (true)
                {
                    l.Add(ReadValue());
                    SkipWs();
                    if (Peek() == ',') { Pos++; continue; }
                    Expect(']');
                    return l;
                }
            }

            private string ReadString()
            {
                Expect('"');
                var sb = new StringBuilder();
                while (true)
                {
                    if (End) throw new FormatException("Unterminated string");
                    char c = _s[Pos++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    char e = _s[Pos++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            sb.Append((char)int.Parse(_s.Substring(Pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            Pos += 4;
                            break;
                        default: throw new FormatException("Bad escape at " + Pos);
                    }
                }
            }

            private double ReadNumber()
            {
                int start = Pos;
                if (Peek() == '-') Pos++;
                while (!End && "0123456789.eE+-".IndexOf(_s[Pos]) >= 0) Pos++;
                return double.Parse(_s.Substring(start, Pos - start), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }

        // ------------------------------------------------------------------ writing

        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value);
            return sb.ToString();
        }

        private static void WriteValue(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); break;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); break;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); break;
                case float f: sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); break;
                case Enum e: WriteString(sb, e.ToString()); break;
                case IDictionary<string, object> dict:
                    sb.Append('{');
                    bool first = true;
                    foreach (var kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        WriteValue(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                case System.Collections.IEnumerable list:
                    sb.Append('[');
                    bool f1 = true;
                    foreach (var item in list)
                    {
                        if (!f1) sb.Append(',');
                        f1 = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    break;
                default: throw new ArgumentException("Cannot serialize " + v.GetType());
            }
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    /// <summary>Typed accessors over parsed JSON objects.</summary>
    public static class JsonExt
    {
        public static string Str(this Dictionary<string, object> d, string k, string def = null)
            => d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : def;

        public static int Int(this Dictionary<string, object> d, string k, int def = 0)
            => d.TryGetValue(k, out var v) && v != null ? Convert.ToInt32(v, CultureInfo.InvariantCulture) : def;

        public static long Long(this Dictionary<string, object> d, string k, long def = 0)
            => d.TryGetValue(k, out var v) && v != null ? Convert.ToInt64(v, CultureInfo.InvariantCulture) : def;

        public static double Num(this Dictionary<string, object> d, string k, double def = 0)
            => d.TryGetValue(k, out var v) && v != null ? Convert.ToDouble(v, CultureInfo.InvariantCulture) : def;

        public static bool Bool(this Dictionary<string, object> d, string k, bool def = false)
            => d.TryGetValue(k, out var v) && v is bool b ? b : def;

        public static Dictionary<string, object> Obj(this Dictionary<string, object> d, string k)
            => d.TryGetValue(k, out var v) ? v as Dictionary<string, object> : null;

        public static List<object> Arr(this Dictionary<string, object> d, string k)
            => d.TryGetValue(k, out var v) ? v as List<object> : null;

        public static List<int> IntList(this Dictionary<string, object> d, string k)
        {
            var r = new List<int>();
            var a = d.Arr(k);
            if (a != null) foreach (var x in a) r.Add(Convert.ToInt32(x, CultureInfo.InvariantCulture));
            return r;
        }

        public static List<string> StrList(this Dictionary<string, object> d, string k)
        {
            var r = new List<string>();
            var a = d.Arr(k);
            if (a != null) foreach (var x in a) r.Add(Convert.ToString(x, CultureInfo.InvariantCulture));
            return r;
        }
    }
}
