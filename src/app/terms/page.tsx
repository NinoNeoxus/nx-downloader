import type { Metadata } from 'next';
import Link from 'next/link';
import { Shield, ArrowLeft, Mail, FileText, AlertTriangle, Scale, Lock, CheckCircle2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Terms of Service — NX Downloader',
  description: 'Terms of Service and legal compliance agreement for NX Downloader (NEOXUS Downloader).',
};

export default function TermsPage() {
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
          background: 'radial-gradient(ellipse 60% 30% at 50% -5%, rgba(14,165,233,0.08) 0%, transparent 70%)',
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-mono">
            <Scale className="w-3.5 h-3.5" />
            <span>Legal Agreement</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Terms of Service
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 font-mono">
            Effective Date: {lastUpdated} • Creator: <span className="text-zinc-200">neoxus</span> • Contact:{' '}
            <a href="mailto:neoxusmoyaa@gmail.com" className="text-cyan-400 underline underline-offset-2">
              neoxusmoyaa@gmail.com
            </a>
          </p>
        </div>

        {/* Legal Notice Banner */}
        <div className="p-4 rounded-xl bg-zinc-900/90 border border-amber-500/30 flex items-start gap-3.5 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-zinc-300 leading-relaxed space-y-1">
            <p className="font-semibold text-white">Important Notice Regarding Service Usage:</p>
            <p>
              NX Downloader is a technical conversion and stream transmission utility. By accessing or using this service,
              you acknowledge and agree that you are solely responsible for ensuring your use complies with all applicable
              copyright laws, platform terms, and fair use guidelines.
            </p>
          </div>
        </div>

        {/* Legal Sections */}
        <div className="space-y-8 text-xs sm:text-sm text-zinc-300 leading-relaxed">
          {/* Section 1 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">1.</span> Acceptance of Terms
            </h2>
            <p>
              These Terms of Service (&quot;Terms&quot;) constitute a legally binding agreement between you
              (&quot;User&quot; or &quot;You&quot;) and the operator of this service (&quot;the Operator&quot;, &quot;we&quot;, &quot;our&quot;, or &quot;us&quot;).
              By accessing, browsing, or utilizing the web services located at this domain or any associated API endpoints,
              you confirm that you have read, understood, and agreed to be bound by these Terms and our Privacy Policy. If you do not agree,
              you must immediately cease using the service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">2.</span> Technical Intermediary &amp; Non-Hosting Disclaimer
            </h2>
            <p>
              <strong>Zero-Storage Architecture:</strong> NX Downloader functions purely as a transient proxy, format multiplexer (muxer),
              and client-side download facilitator. Specifically:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>We do <strong>NOT</strong> host, store, index, archive, or maintain any database of audio, video, or image files.</li>
              <li>All media processing is strictly real-time and ephemeral. Temporary chunks processed in server memory or cache are purged automatically within minutes upon delivery.</li>
              <li>We do not provide searchable catalogs, recommendations, or playlists of copyrighted content.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">3.</span> Third-Party Platform Trademarks &amp; Non-Affiliation
            </h2>
            <p>
              This service is an independent utility. It is not affiliated with, endorsed by,
              sponsored by, or authorized by YouTube (Google LLC), TikTok (ByteDance Ltd.), Instagram / Facebook (Meta Platforms, Inc.),
              or any of their respective affiliates. All trademarks, service marks, platform names, and logos displayed on this website
              belong exclusively to their respective owners and are referenced solely for descriptive identification purposes.
            </p>
          </section>

          {/* Section 4 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">4.</span> User Representations, Fair Use &amp; Prohibited Conduct
            </h2>
            <p>You warrant and represent that:</p>
            <ul className="list-disc pl-5 space-y-1 text-zinc-400">
              <li>You will use NX Downloader exclusively for personal, non-commercial, archival, educational, or legally protected Fair Use purposes under relevant copyright statutes.</li>
              <li>You will not use this service to infringe upon the intellectual property, copyright, patent, trademark, or privacy rights of any third party.</li>
              <li>You will not commercialize, sell, rent, or redistribute any materials downloaded using this service without appropriate copyright owner authorization.</li>
              <li>You will not engage in automated scraping, denial of service (DoS/DDoS) attacks, rate-limit bypassing, or malicious reverse-engineering of the service infrastructure.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">5.</span> DMCA &amp; Copyright Infringement Takedown Procedure
            </h2>
            <p>
              We respect copyright holders and comply with the Digital Millennium Copyright Act (17 U.S.C. § 512) and international
              intellectual property norms. Because NX Downloader does not host or store files, our primary remediation is blocking
              specific content URLs or domain access through our routing engine.
            </p>
            <p>
              If you are a copyright owner or authorized agent and believe that content accessible through our utility infringes your rights,
              please submit a written takedown notice containing:
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-zinc-400">
              <li>Identification of the copyrighted work claimed to have been infringed.</li>
              <li>The exact URL(s) you request to be blocked by our system.</li>
              <li>Your contact information (full name, address, telephone number, and email).</li>
              <li>A statement that you have a good faith belief that use of the material is unauthorized.</li>
              <li>A statement under penalty of perjury that the information in the notification is accurate and you are authorized to act.</li>
            </ol>
            <div className="p-3 rounded-lg bg-black/50 border border-zinc-800 font-mono text-xs text-zinc-300">
              Designated Agent Email: <a href="mailto:neoxusmoyaa@gmail.com" className="text-cyan-400 hover:underline">neoxusmoyaa@gmail.com</a>
              <br />
              Recipient: neoxus Legal &amp; Compliance Team
            </div>
          </section>

          {/* Section 6 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">6.</span> Disclaimer of Warranties (&quot;AS IS&quot;)
            </h2>
            <p>
              NX DOWNLOADER IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, THE OPERATOR (&quot;NEOXUS&quot;) DISCLAIMS ALL WARRANTIES,
              INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, FREEDOM FROM SERVICE DISRUPTIONS,
              AND NON-INFRINGEMENT. WE DO NOT GUARANTEE THAT THE SERVICE WILL ALWAYS BE SECURE, TIMELY, OR ERROR-FREE.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">7.</span> Limitation of Liability &amp; Indemnification
            </h2>
            <p>
              IN NO EVENT SHALL NEOXUS, ITS OPERATORS, CONTRIBUTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
              SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF DATA, REVENUE, GOODWILL, OR
              LEGAL CLAIMS ARISING FROM YOUR ACCESS TO, USE OF, OR INABILITY TO USE THE SERVICE.
            </p>
            <p>
              You agree to defend, indemnify, and hold harmless <strong>neoxus</strong> from and against any claims, damages, obligations,
              losses, liabilities, costs, or expenses (including attorney fees) resulting from: (i) your violation of these Terms;
              (ii) your infringement of any third-party intellectual property or privacy right; or (iii) any misuse of media downloaded
              through NX Downloader.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3 bg-zinc-900/40 p-5 rounded-xl border border-zinc-800/70">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono text-sm">8.</span> Modifications &amp; Governing Law
            </h2>
            <p>
              We reserve the right to revise or update these Terms at any time without prior notice. Continued use of the service
              following any modifications constitutes your formal acceptance of the updated Terms.
            </p>
          </section>
        </div>

        {/* Footer Contact */}
        <div className="pt-6 border-t border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500 font-mono">
          <div>NX Downloader • Engineered by neoxus</div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-zinc-300 transition-colors">Privacy Policy</Link>
            <span>•</span>
            <a href="mailto:neoxusmoyaa@gmail.com" className="hover:text-zinc-300 transition-colors">Contact Support</a>
          </div>
        </div>
      </div>
    </main>
  );
}
