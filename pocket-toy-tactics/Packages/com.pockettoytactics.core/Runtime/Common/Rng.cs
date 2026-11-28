using System;
using System.Collections.Generic;
using System.Globalization;

namespace PocketToyTactics.Core
{
    /// <summary>
    /// Deterministic, serializable PRNG (SplitMix64). System.Random is not guaranteed to produce
    /// the same sequence across runtimes (Mono, IL2CPP, CoreCLR), which would break replays and
    /// save files; this one is bit-identical everywhere.
    /// </summary>
    public sealed class Rng
    {
        public ulong State;

        public Rng(ulong seed) { State = seed; }

        public ulong NextULong()
        {
            ulong z = (State += 0x9E3779B97F4A7C15UL);
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }

        /// <summary>Uniform integer in [0, maxExclusive).</summary>
        public int Next(int maxExclusive)
        {
            if (maxExclusive <= 0) throw new ArgumentOutOfRangeException(nameof(maxExclusive));
            ulong bound = (ulong)maxExclusive;
            ulong threshold = (ulong.MaxValue - bound + 1) % bound;
            while (true)
            {
                ulong r = NextULong();
                if (r >= threshold) return (int)(r % bound);
            }
        }

        public double NextDouble() => (NextULong() >> 11) * (1.0 / (1UL << 53));

        public void Shuffle<T>(IList<T> list)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = Next(i + 1);
                T t = list[i];
                list[i] = list[j];
                list[j] = t;
            }
        }

        public Rng Clone() => new Rng(State);

        public string Serialize() => State.ToString("x16", CultureInfo.InvariantCulture);

        public static Rng Deserialize(string hex) => new Rng(ulong.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
    }
}
