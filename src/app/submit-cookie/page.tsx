'use client';

import { useState, useRef, ChangeEvent, DragEvent } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ShieldCheck,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  ArrowLeft,
  Info,
  ExternalLink,
} from 'lucide-react';

type PlatformKey = 'youtube' | 'instagram' | 'tiktok';

export default function SubmitCookiePage() {
  const [platform, setPlatform] = useState<PlatformKey>('youtube');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.txt') && f.type !== 'text/plain') {
      toast.error('File Tidak Valid', {
        description: 'Harap upload file berformat Netscape cookies (.txt).',
      });
      return;
    }
    setFile(f);
    toast.info('File Dipilih', { description: f.name });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error('Pilih File', { description: 'Silakan pilih file cookie .txt terlebih dahulu.' });
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.append('platform', platform);
    formData.append('file', file);
    if (note) formData.append('note', note);

    try {
      const res = await fetch('/api/submit-cookie', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsSubmitted(true);
        toast.success('Berhasil Terkirim!', {
          description: data.message || 'Cookie berhasil disumbangkan ke server.',
        });
      } else {
        toast.error('Gagal Mengirim', {
          description: data.error || 'Terjadi kesalahan saat memproses cookie.',
        });
      }
    } catch {
      toast.error('Koneksi Gagal', { description: 'Tidak dapat menghubungi server.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 py-12 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Back Link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-brand-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Kembali ke Neoxus Downloader
        </Link>

        {/* Header Card */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 backdrop-blur-xl shadow-xl space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Bantu Perbarui Cookie Server</h1>
              <p className="text-xs text-zinc-400">
                Sumbang cookie browser Anda secara anonim agar server dapat terus mengunduh video batas usia & bypass bot protection.
              </p>
            </div>
          </div>
        </div>

        {/* Step by Step Guide */}
        <div className="p-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Info className="w-4 h-4 text-brand-400" /> Cara Ekspor Cookie Netscape (.txt)
          </div>
          <ol className="text-xs text-zinc-400 space-y-2 list-decimal list-inside leading-relaxed">
            <li>
              Install ekstensi browser resmi:{' '}
              <a
                href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                target="_blank"
                rel="noreferrer"
                className="text-brand-400 hover:underline inline-flex items-center gap-1 font-medium"
              >
                Get cookies.txt LOCALLY <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>Buka tab platform yang ingin disumbangkan (misal: YouTube, Instagram, atau TikTok) dan pastikan akun Anda login.</li>
            <li>Klik icon ekstensi pada tab tersebut, lalu klik <strong>Export as Netscape (.txt)</strong>.</li>
            <li>Upload file .txt hasil ekspor tersebut di formulir bawah ini.</li>
          </ol>
        </div>

        {/* Form */}
        {isSubmitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-8 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 text-center space-y-4"
          >
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold text-white">Terima Kasih Banyak!</h2>
            <p className="text-xs text-zinc-300 max-w-md mx-auto">
              Cookie {platform.toUpperCase()} Anda telah berhasil disumbangkan ke server. Kontribusi Anda sangat membantu menjaga unduhan tetap lancar untuk semua orang.
            </p>
            <button
              onClick={() => {
                setFile(null);
                setNote('');
                setIsSubmitted(false);
              }}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
            >
              Kirim Cookie Lain
            </button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 space-y-5">
            {/* Platform Picker */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300">Pilih Platform</label>
              <div className="grid grid-cols-3 gap-2">
                {(['youtube', 'instagram', 'tiktok'] as PlatformKey[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition-all ${
                      platform === p
                        ? 'bg-brand-600/20 border-brand-500 text-brand-300 shadow-md'
                        : 'bg-zinc-800/40 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Drag & Drop Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                isDragging
                  ? 'border-brand-500 bg-brand-500/10'
                  : file
                  ? 'border-emerald-500/50 bg-emerald-950/10'
                  : 'border-zinc-700/60 hover:border-zinc-600 bg-zinc-900/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {file ? (
                <div className="space-y-2">
                  <FileText className="w-10 h-10 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold text-white truncate max-w-xs mx-auto">{file.name}</p>
                  <p className="text-xs text-zinc-400 font-mono">{(file.size / 1024).toFixed(1)} KB</p>
                  <span className="text-[11px] text-zinc-500 underline">Klik untuk ganti file</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-10 h-10 text-zinc-500 mx-auto" />
                  <p className="text-sm font-medium text-zinc-300">Tarik & Lepaskan file cookie .txt di sini</p>
                  <p className="text-xs text-zinc-500">atau klik untuk memilih dari komputer / HP</p>
                </div>
              )}
            </div>

            {/* Optional Note */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300">Catatan Tambahan (Opsional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: Akun Google cadangan aktif 2026"
                className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-800/60 border border-zinc-700/60 text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!file || isSubmitting}
              className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                !file || isSubmitting
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white shadow-lg shadow-brand-600/20'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Mengirim Cookie…
                </>
              ) : (
                'Kirimkan Cookie ke Server'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
