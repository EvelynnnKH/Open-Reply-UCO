"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AccountSelect, { type AccountOption } from "@/components/account-select";

export interface QuestionItem {
  id: string;
  label: string;
  isCollectAnswer: boolean;
  variableKey: string;
  type: "text" | "button";
  options: string[];
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

interface InstagramPost {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  // Base OpenReply Campaign States
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [keywords, setKeywords] = useState("");
  const [matchAnyWord, setMatchAnyWord] = useState(false);
  const [matchAnyPost, setMatchAnyPost] = useState(true);
  const [pendingNextReel, setPendingNextReel] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);

  // Instagram Posts Fetch State
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // DM, Link & Follow Requirement States
  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] = useState("");
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("");

  // Follow Up States
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(15);

  // Public Reply States
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  // Dynamic Form Builder State (Google Form Style)
  const [isLeadFormEnabled, setIsLeadFormEnabled] = useState(true);
  const [questions, setQuestions] = useState<QuestionItem[]>([
    {
      id: "1",
      label: "Boleh diinfokan Nama Lengkap Kakak ?",
      isCollectAnswer: true,
      variableKey: "fullName",
      type: "text",
      options: [],
    },
    {
      id: "2",
      label: "Kakak tertarik dengan jurusan apa?",
      isCollectAnswer: true,
      variableKey: "major",
      type: "button",
      options: ["S1 Informatika", "S1 Manajemen", "S2 Manajemen"],
    },
  ]);

  const [loading, setLoading] = useState(mode === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch Instagram Accounts
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success && payload.data.instagramAccounts?.length > 0) {
          setAccounts(payload.data.instagramAccounts);
          setSelectedAccountId((prev) => prev || payload.data.instagramAccounts[0].id);
        }
      })
      .catch(console.error);
  }, []);

  // 2. Fetch Account Posts for Trigger Selection
  useEffect(() => {
    if (!selectedAccountId) return;
    setLoadingPosts(true);
    fetch(`/api/instagram/posts?instagramAccountId=${selectedAccountId}&limit=20`)
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success && Array.isArray(payload.data)) {
          setPosts(payload.data);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingPosts(false));
  }, [selectedAccountId]);

  // 3. Edit Mode: Fetch Campaign Data
  useEffect(() => {
    if (mode === "edit" && campaignId) {
      fetch(`/api/automations?id=${campaignId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            const auto = data.data;
            setName(auto.name || "");
            setGoal(auto.goal || "");
            setKeywords(Array.isArray(auto.keywords) ? auto.keywords.join(", ") : "");
            setMatchAnyWord(auto.matchAnyWord ?? false);
            setMatchAnyPost(auto.matchAnyPost ?? true);
            setPendingNextReel(auto.pendingNextReel ?? false);
            setPostId(auto.postId || null);
            setPostUrl(auto.postUrl || null);
            setSelectedAccountId(auto.instagramAccountId || "");

            setOpeningDmEnabled(auto.openingDmEnabled ?? false);
            setOpeningDmMessage(auto.openingDmMessage || "");
            setOpeningDmButtonLabel(auto.openingDmButtonLabel || "");
            setLinkButtonLabel(auto.linkButtonLabel || "");

            setRequireFollow(auto.requireFollow ?? false);
            setFollowPromptMessage(auto.followPromptMessage || "");
            setFollowPromptButtonLabel(auto.followPromptButtonLabel || "");

            setFollowUpEnabled(auto.followUpEnabled ?? false);
            setFollowUpMessage(auto.followUpMessage || "");
            setFollowUpDelayMinutes(auto.followUpDelayMinutes || 15);

            setPublicReplyEnabled(auto.publicReplyEnabled ?? false);
            setPublicReplyMessages(auto.publicReplyMessages?.length ? auto.publicReplyMessages : [""]);

            if (auto.trackedLinks && auto.trackedLinks.length > 0) {
              setTrackedDestinationUrl(auto.trackedLinks[0]?.destinationUrl || "");
              if (auto.trackedLinks.length > 1) {
                setSecondaryDestinationUrl(auto.trackedLinks[1]?.destinationUrl || "");
                setSecondaryButtonLabel(auto.trackedLinks[1]?.label || "");
              }
            }

            if (typeof auto.isLeadFormEnabled === "boolean") {
              setIsLeadFormEnabled(auto.isLeadFormEnabled);
            }
            if (Array.isArray(auto.questions) && auto.questions.length > 0) {
              setQuestions(auto.questions);
            }
          }
        })
        .finally(() => setLoading(false));
    }
  }, [mode, campaignId]);

  // Question Helper Functions
  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        label: "",
        isCollectAnswer: true,
        variableKey: `field_${prev.length + 1}`,
        type: "text",
        options: [],
      },
    ]);
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateQuestionType = (index: number, type: "text" | "button") => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[index].type = type;
      if (type === "button" && updated[index].options.length === 0) {
        updated[index].options = [""];
      }
      return updated;
    });
  };

  const addOption = (qIndex: number) => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[qIndex].options.push("");
      return updated;
    });
  };

  const updateOption = (qIndex: number, optIndex: number, value: string) => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[qIndex].options[optIndex] = value;
      return updated;
    });
  };

  const removeOption = (qIndex: number, optIndex: number) => {
    setQuestions((prev) => {
      const updated = [...prev];
      updated[qIndex].options = updated[qIndex].options.filter((_, i) => i !== optIndex);
      return updated;
    });
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Nama Campaign wajib diisi.");
      return;
    }

    setSubmitting(true);

    const kwArray = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const payload = {
      name,
      goal: goal.trim() === "" ? null : goal,
      instagramAccountId: selectedAccountId,
      matchAnyWord,
      keywords: kwArray,
      matchAnyPost,
      pendingNextReel,
      postId: matchAnyPost || pendingNextReel ? null : postId,
      postUrl: matchAnyPost || pendingNextReel ? null : postUrl,
      dmMessage: questions[0]?.label || "Lead Form DM",

      openingDmEnabled,
      openingDmMessage: openingDmEnabled ? openingDmMessage || null : null,
      openingDmButtonLabel: openingDmEnabled ? openingDmButtonLabel || null : null,
      linkButtonLabel: linkButtonLabel || null,

      requireFollow,
      followPromptMessage: requireFollow ? followPromptMessage || null : null,
      followPromptButtonLabel: requireFollow ? followPromptButtonLabel || null : null,

      followUpEnabled,
      followUpMessage: followUpEnabled ? followUpMessage || null : null,
      followUpDelayMinutes: followUpEnabled ? Number(followUpDelayMinutes) : 0,

      publicReplyEnabled,
      publicReplyMessages: publicReplyEnabled ? publicReplyMessages.filter(Boolean) : [],

      trackedDestinationUrl: trackedDestinationUrl || "",
      secondaryDestinationUrl: secondaryDestinationUrl || "",
      secondaryButtonLabel: secondaryButtonLabel || "",

      isLeadFormEnabled,
      questions: isLeadFormEnabled ? questions : [],
      isActive: true,
    };

    try {
      const url = mode === "edit" ? `/api/automations?id=${campaignId}` : "/api/automations";
      const method = mode === "edit" ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        router.push("/campaigns");
        router.refresh();
      } else {
        setError(data.error || "Gagal menyimpan campaign.");
      }
    } catch (err) {
      console.error(err);
      setError("Terjadi kesalahan koneksi.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-muted">Memuat data campaign...</div>;

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold">
            {mode === "new" ? "New Campaign" : "Edit Campaign"}
          </h1>
          <p className="text-sm text-muted">
            Atur postingan pemicu, kata kunci, follow gate, dan alur form interaktif.
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Save Campaign"}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          {error}
        </div>
      )}

      {/* 1. Pengaturan Utama & Akun */}
      <div className="panel rounded p-6 space-y-4">
        <h2 className="text-base font-semibold">1. Pengaturan Umum</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium mb-1">Nama Campaign *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Misal: Lead Campaign UC Online 2026"
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Akun Instagram</label>
            <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Goal Campaign (Opsional)</label>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Misal: Mengumpulkan leads calon mahasiswa"
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 2. Pemilih Postingan Pemicu (Trigger Post Selector) */}
      <div className="panel rounded p-6 space-y-4">
        <h2 className="text-base font-semibold">2. Postingan Pemicu (Post Trigger)</h2>
        <div className="space-y-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer font-medium">
            <input
              type="radio"
              name="postTrigger"
              checked={matchAnyPost}
              onChange={() => {
                setMatchAnyPost(true);
                setPendingNextReel(false);
                setPostId(null);
                setPostUrl(null);
              }}
              className="accent-accent"
            />
            Berlaku untuk SEMUA Postingan / Reels di Akun
          </label>

          <label className="flex items-center gap-2 cursor-pointer font-medium">
            <input
              type="radio"
              name="postTrigger"
              checked={pendingNextReel}
              onChange={() => {
                setMatchAnyPost(false);
                setPendingNextReel(true);
                setPostId(null);
                setPostUrl(null);
              }}
              className="accent-accent"
            />
            Otomatis terhubung ke Reels BERIKUTNYA yang diposting
          </label>

          <label className="flex items-center gap-2 cursor-pointer font-medium">
            <input
              type="radio"
              name="postTrigger"
              checked={!matchAnyPost && !pendingNextReel}
              onChange={() => {
                setMatchAnyPost(false);
                setPendingNextReel(false);
              }}
              className="accent-accent"
            />
            Pilih Postingan / Reels Spesifik
          </label>
        </div>

        {/* Post Selector Grid */}
        {!matchAnyPost && !pendingNextReel && (
          <div className="pt-3 border-t border-border">
            <p className="text-xs font-medium text-muted mb-2">Pilih salah satu postingan dari akun kamu:</p>
            {loadingPosts ? (
              <p className="text-xs text-muted">Memuat postingan Instagram...</p>
            ) : posts.length === 0 ? (
              <p className="text-xs text-muted">Tidak ada postingan ditemukan di akun ini.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 max-h-60 overflow-y-auto p-1">
                {posts.map((p) => {
                  const img = p.thumbnail_url || p.media_url;
                  const isSelected = postId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setPostId(p.id);
                        setPostUrl(p.permalink || null);
                      }}
                      className={`relative aspect-square cursor-pointer rounded overflow-hidden border-2 transition-all ${
                        isSelected ? "border-accent ring-2 ring-accent/30" : "border-transparent opacity-80 hover:opacity-100"
                      }`}
                    >
                      {img ? (
                        <img src={img} alt="post" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-surface flex items-center justify-center text-[10px] p-1 text-center truncate">
                          {p.caption || "Post"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Pengaturan Kata Kunci (Keywords) */}
      <div className="panel rounded p-6 space-y-4">
        <h2 className="text-base font-semibold">3. Kata Kunci Komentar (Keywords)</h2>
        <div className="flex items-center gap-4 text-xs mb-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="kwType"
              checked={matchAnyWord}
              onChange={() => setMatchAnyWord(true)}
            />
            Respon SEMUA Komentar (Tanpa Kata Kunci Spesifik)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="kwType"
              checked={!matchAnyWord}
              onChange={() => setMatchAnyWord(false)}
            />
            Hanya Komentar yang Mengandung Kata Kunci
          </label>
        </div>

        {!matchAnyWord && (
          <div>
            <label className="block text-xs font-medium mb-1">
              Daftar Kata Kunci (Pisahkan dengan koma)
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="info, daftar, mau, kuliah"
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
        )}
      </div>

      {/* 4. Mandatory Follow Requirement & Public Reply */}
      <div className="panel rounded p-6 space-y-4">
        <h2 className="text-base font-semibold">4. Mandatory Follow & Public Reply</h2>

        {/* Require Follow */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <p className="text-sm font-medium">Syarat Wajib Follow (Follow Gate)</p>
            <p className="text-xs text-muted">Minta user follow akun kamu dulu sebelum alur pertanyaan dikirim.</p>
          </div>
          <input
            type="checkbox"
            checked={requireFollow}
            onChange={(e) => setRequireFollow(e.target.checked)}
            className="w-5 h-5 accent-accent"
          />
        </div>

        {requireFollow && (
          <div className="space-y-3 pl-4 border-l-2 border-accent">
            <div>
              <label className="block text-xs font-medium mb-1">Pesan Pengingat Follow</label>
              <input
                type="text"
                value={followPromptMessage}
                onChange={(e) => setFollowPromptMessage(e.target.value)}
                placeholder="Follow akun kami dulu yuk untuk akses informasi lengkapnya!"
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Label Tombol Konfirmasi Follow</label>
              <input
                type="text"
                value={followPromptButtonLabel}
                onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                placeholder="Sudah Follow"
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        )}

        {/* Public Reply */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <p className="text-sm font-medium">Balas Komentar Publik Otomatis</p>
            <p className="text-xs text-muted">Kirim balasan langsung di kolom komentar postingan Instagram.</p>
          </div>
          <input
            type="checkbox"
            checked={publicReplyEnabled}
            onChange={(e) => setPublicReplyEnabled(e.target.checked)}
            className="w-5 h-5 accent-accent"
          />
        </div>

        {publicReplyEnabled && (
          <div className="pl-4 border-l-2 border-accent space-y-2">
            <label className="block text-xs font-medium">Teks Balasan Komentar</label>
            {publicReplyMessages.map((msg, mIdx) => (
              <div key={mIdx} className="flex gap-2">
                <input
                  type="text"
                  value={msg}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPublicReplyMessages((prev) => {
                      const updated = [...prev];
                      updated[mIdx] = val;
                      return updated;
                    });
                  }}
                  placeholder="Cek DM kamu yaa Kak! 📩"
                  className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs"
                />
                {publicReplyMessages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPublicReplyMessages((prev) => prev.filter((_, i) => i !== mIdx))}
                    className="text-xs text-red-400"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPublicReplyMessages((prev) => [...prev, ""])}
              className="text-xs text-accent hover:underline block pt-1"
            >
              + Tambah Variasi Balasan Komentar
            </button>
          </div>
        )}
      </div>

      {/* 5. Follow-Up Automated Reminders */}
      <div className="panel rounded p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">5. Follow-Up Reminders</h2>
            <p className="text-xs text-muted">Kirim pesan pengingat otomatis jika user tidak membalas DM.</p>
          </div>
          <input
            type="checkbox"
            checked={followUpEnabled}
            onChange={(e) => setFollowUpEnabled(e.target.checked)}
            className="w-5 h-5 accent-accent"
          />
        </div>

        {followUpEnabled && (
          <div className="space-y-3 pl-4 border-l-2 border-accent">
            <div>
              <label className="block text-xs font-medium mb-1">Pesan Follow-Up</label>
              <input
                type="text"
                value={followUpMessage}
                onChange={(e) => setFollowUpMessage(e.target.value)}
                placeholder="Halo Kak, apakah ada yang bisa kami bantu mengenai info pendaftaran?"
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Waktu Tunggu (Menit)</label>
              <input
                type="number"
                value={followUpDelayMinutes}
                onChange={(e) => setFollowUpDelayMinutes(Number(e.target.value))}
                className="w-32 rounded border border-border bg-background px-3 py-1.5 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {/* 6. Interactive Lead Form Builder (Google Form Style) */}
      <div className="panel rounded p-6 space-y-6 border-2 border-accent/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-accent">6. Interactive Lead Form Builder</h2>
            <p className="text-xs text-muted">
              Atur urutan pertanyaan dinamis. Jawaban user akan otomatis tersimpan sesuai variabelnya.
            </p>
          </div>
          <button
            type="button"
            onClick={addQuestion}
            className="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded hover:bg-accent-hover"
          >
            + Tambah Pesan / Pertanyaan
          </button>
        </div>

        <div className="space-y-4">
          {questions.map((q, qIdx) => (
            <div key={q.id} className="p-4 rounded border border-border bg-surface space-y-4 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-accent uppercase tracking-wider">
                  Langkah #{qIdx + 1}
                </span>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(qIdx)}
                    className="text-xs text-red-400 hover:text-red-300 font-semibold"
                  >
                    Hapus
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-medium">Teks Pesan / Pertanyaan</label>
                <input
                  type="text"
                  value={q.label}
                  onChange={(e) => {
                    const val = e.target.value;
                    setQuestions((prev) => {
                      const updated = [...prev];
                      updated[qIdx].label = val;
                      return updated;
                    });
                  }}
                  placeholder="Misal: Boleh diinfokan Nama Lengkap Kakak ?"
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-4 p-3 rounded bg-background border border-border text-xs">
                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="radio"
                    name={`isCollect_${q.id}`}
                    checked={!q.isCollectAnswer}
                    onChange={() => {
                      setQuestions((prev) => {
                        const updated = [...prev];
                        updated[qIdx].isCollectAnswer = false;
                        return updated;
                      });
                    }}
                    className="accent-accent"
                  />
                  Hanya Pesan Informasi (Langsung Lanjut)
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="radio"
                    name={`isCollect_${q.id}`}
                    checked={q.isCollectAnswer}
                    onChange={() => {
                      setQuestions((prev) => {
                        const updated = [...prev];
                        updated[qIdx].isCollectAnswer = true;
                        return updated;
                      });
                    }}
                    className="accent-accent"
                  />
                  Minta Jawaban User (Simpan ke Variable)
                </label>
              </div>

              {q.isCollectAnswer && (
                <div className="pl-4 border-l-2 border-accent space-y-3 pt-1">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">
                        Simpan Jawaban ke Variable:
                      </label>
                      <input
                        type="text"
                        value={q.variableKey}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\s+/g, "_");
                          setQuestions((prev) => {
                            const updated = [...prev];
                            updated[qIdx].variableKey = val;
                            return updated;
                          });
                        }}
                        placeholder="fullName, major, age, dll"
                        className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-muted mb-1">Tipe Balasan User:</label>
                      <div className="flex items-center gap-4 pt-1.5 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`type_${q.id}`}
                            checked={q.type === "text"}
                            onChange={() => updateQuestionType(qIdx, "text")}
                          />
                          Teks Manual
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`type_${q.id}`}
                            checked={q.type === "button"}
                            onChange={() => updateQuestionType(qIdx, "button")}
                          />
                          Tombol Quick Reply
                        </label>
                      </div>
                    </div>
                  </div>

                  {q.type === "button" && (
                    <div className="space-y-2 pt-2">
                      <label className="block text-xs font-semibold text-muted">Daftar Pilihan Tombol:</label>
                      {q.options.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => updateOption(qIdx, optIdx, e.target.value)}
                            placeholder={`Pilihan ${optIdx + 1}`}
                            className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
                          />
                          {q.options.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeOption(qIdx, optIdx)}
                              className="text-xs text-red-400"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(qIdx)}
                        className="text-xs text-accent hover:underline pt-1 block"
                      >
                        + Tambah Opsi Tombol
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}