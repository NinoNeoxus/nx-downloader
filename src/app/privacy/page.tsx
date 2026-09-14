import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, ArrowLeft, Lock, EyeOff, Server, Database, Globe, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy — NX Downloader',
  description: 'Privacy Policy and data handling practices for NX Downloader (NEOXUS Downloader).',
};

export default function PrivacyPage() {
  const lastUpdated = 'September 14, 2026';

  return (
    <main className="relative min-h-screen bg-zinc-950 text-zinc-100 px-4 pt-28 pb-20 overflow-hidden">
      {/* Background layered glow */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.12]"
        style={{
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 20%, transparent 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 60% 30% at 50% -5%, rgba(16,185,129,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 max-w-3xl mx-auto space-y-10">
        {/* Navigation Breadcrumb */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-white transition-colors group"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
          <span>Back to NX Downloader</span>
        </Link>

        {/* Page Header */}
        <div className="space-y-3 border-b border-zinc-800/80 pb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Data Protection &amp; Privacy</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Privacy Policy
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 font-mono">
            Effective Date: {lastUpdated} • Creator: <span className="text-zinc-200">neoxus</span> • Contact:{' '}
            <a href="mailto:neoxusmoyaa@gmail.com" className="text-emerald-400 underline underline-offset-2">
              neoxusmoyaa@gmail.com
            </a>
          </p>
        </div>

        {/* Privacy Highlights Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1.5">
            <EyeOff className="w-4 h-4 text-emerald-400" />
            <div className="text-xs font-semibold text-white">No User Accounts</div>
            <div className="text-[11px] text-zinc-400 leading-normal">
              No registration, emails, passwords, or personal profiles required.
            </div>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1.5">
            <Server className="w-4 h-4 text-cyan-400" />
            <div className="text-xs font-semibold text-white">Zero Media Retention</div>
            <div className="text-[11px] text-zinc-400 leading-normal">
              Media is streamed on-the-fly. Temporary files are purged within minutes.
            </div>
          </div>
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-1.5">
            <Lock className="w-4 h-4 text-purple-400" />
            <div className="text-xs font-semibold text-white">No Ad Trackers</div>
            <div className="text-[11px] text-zinc-400 leading-normal">
              We do not sell data, track browsing history, or run invasive ad pixels.
            </div>
          </div>
        </div>

        {/* Privacy Content Sections */}
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
          {/* Section 1 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">1.</span> Introduction &amp; Commitment
            </h2>
            <p>
              We believe privacy is a fundamental human right.
              Our service is intentionally architected to minimize data processing to the absolute technical necessity.
              This Privacy Policy explains how our service handles technical information when you visit this website.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">2.</span> Zero-Retention Media Processing Architecture
            </h2>
            <p>
              When you submit a URL to extract or convert a video or audio stream:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>Our backend servers act solely as a real-time stream conduit and multiplexer.</li>
              <li>We do <strong>NOT</strong> maintain any permanent database, archive, cloud storage bucket, or library of downloaded media.</li>
              <li>Any temporary chunks generated during conversion are stored in volatile ephemeral cache directories and are strictly scheduled for automated purge immediately upon completion or cancellation.</li>
              <li>We do not correlate submitted URLs with personal user identities.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">3.</span> Information We Do NOT Collect
            </h2>
            <p>
              We pride ourselves on our non-invasive architecture. We explicitly do <strong>NOT</strong> collect:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>Your name, home address, or phone number.</li>
              <li>Your credit card, billing, or financial payment details.</li>
              <li>Your social media credentials, passwords, or personal profiles.</li>
              <li>Persistent browsing histories outside of direct interaction with this site.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">4.</span> Technical &amp; Operational Logs (Security &amp; Anti-Abuse)
            </h2>
            <p>
              Like any web service operating publicly on the internet, our server logs ephemeral technical data to maintain system stability, prevent DDoS attacks, and enforce fair rate limits:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li><strong>IP Address:</strong> Processed in-memory and hashed/truncated for rate-limiting (e.g. limiting requests to prevent server exhaustion).</li>
              <li><strong>User-Agent &amp; Request Headers:</strong> Used solely to detect malicious automated bots, scrapers, or security vulnerabilities.</li>
              <li><strong>Timestamps &amp; HTTP Status:</strong> Used to monitor server uptime, error rates, and proxy latency.</li>
            </ul>
            <p className="text-zinc-400 text-xs">
              These operational logs are stored securely with restricted access and are rotated and discarded automatically on a rolling basis.
            </p>
          </section>

          {/* Section 5 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">5.</span> Cookies &amp; Local Browser Storage
            </h2>
            <p>
              NX Downloader uses minimal local storage strictly for essential, functional purposes:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li><strong>Client State:</strong> Storing temporary UI states, such as active render session identifiers (`renderId`) to allow cancellation if you close the tab.</li>
              <li><strong>Security Tokens:</strong> Functional session tokens used solely for cryptographic rate-limit verification and anti-abuse protection.</li>
              <li><strong>No Third-Party Advertising Cookies:</strong> We do not employ third-party behavioral advertising trackers, Google Analytics cross-site remarketing, or Facebook tracking pixels.</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">6.</span> Third-Party Media Providers
            </h2>
            <p>
              When you download public media via NX Downloader, your browser or our proxy connects to the respective public CDN hosting the source media (such as YouTube, TikTok, Instagram, or Facebook). These third-party platforms have their own independent privacy policies governing their CDNs. NX Downloader has no control over or responsibility for the policies of external platforms.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-sm">7.</span> Contact &amp; Inquiries
            </h2>
            <p>
              If you have any questions, concerns, or requests regarding this Privacy Policy or our zero-retention practices, you may directly reach out to the developer and operator:
            </p>
            <div className="p-3 rounded-lg bg-black/50 border border-zinc-800 font-mono text-xs text-zinc-300">
              Creator: neoxus
              <br />
              Direct Email:{' '}
              <a href="mailto:neoxusmoyaa@gmail.com" className="text-emerald-400 hover:underline">
                neoxusmoyaa@gmail.com
              </a>
            </div>
          </section>
        </div>

        {/* Footer Contact */}
        <div className="pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500 font-mono">
          <div>NX Downloader • Engineered by neoxus</div>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-zinc-300 transition-colors">Terms of Service</Link>
            <span>•</span>
            <a href="mailto:neoxusmoyaa@gmail.com" className="hover:text-zinc-300 transition-colors">Contact Support</a>
          </div>
        </div>
      </div>
    </main>
  );
}
