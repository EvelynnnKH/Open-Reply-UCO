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

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  // Standard OpenReply States
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [keywords, setKeywords] = useState("");
  const [matchAnyWord, setMatchAnyWord] = useState(true);
  const [matchAnyPost, setMatchAnyPost] = useState(true);
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] = useState("");
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  // GForm Dynamic Builder State
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
      options: ["S1 Informatika", "S1 Bisnis", "S1 Desain"],
    },
  ]);

  const [loading, setLoading] = useState(mode === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success && payload.data.instagramAccounts?.length > 0) {
          setAccounts(payload.data.instagramAccounts);
          setSelectedAccountId(payload.data.instagramAccounts[0].id);
        }
      })
      .catch(console.error);
  }, []);

  // Mode EDIT: Fetch existing campaign data
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
            setMatchAnyWord(auto.matchAnyWord ?? true);
            setMatchAnyPost(auto.matchAnyPost ?? true);
            setPostId(auto.postId || null);
            setPostUrl(auto.postUrl || null);
            setSelectedAccountId(auto.instagramAccountId || "");
            setOpeningDmEnabled(auto.openingDmEnabled ?? false);
            setOpeningDmMessage(auto.openingDmMessage || "");
            setOpeningDmButtonLabel(auto.openingDmButtonLabel || "");
            setRequireFollow(auto.requireFollow ?? false);
            setFollowPromptMessage(auto.followPromptMessage || "");
            setFollowPromptButtonLabel(auto.followPromptButtonLabel || "");
            setPublicReplyEnabled(auto.publicReplyEnabled ?? false);
            setPublicReplyMessages(auto.publicReplyMessages?.length ? auto.publicReplyMessages : [""]);
            setTrackedDestinationUrl(auto.trackedLinks?.[0]?.destinationUrl || "");

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

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        label: "",
        isCollectAnswer: true,
        variableKey: `field_${prev.length + 1}`,
        type: "text",
        options: [""],
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Nama Campaign tidak boleh kosong.");
      return;
    }

    setSubmitting(true);

    const kwArray = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const payload = {
      name,
      goal: goal.trim() || null,
      instagramAccountId: selectedAccountId,
      matchAnyWord: kwArray.length === 0,
      keywords: kwArray,
      matchAnyPost: true,
      pendingNextReel: false,
      postId,
      postUrl,
      dmMessage: questions[0]?.label || "Lead Form DM",
      openingDmEnabled,
      openingDmMessage: openingDmMessage || null,
      openingDmButtonLabel: openingDmButtonLabel || null,
      requireFollow,
      followPromptMessage: followPromptMessage || null,
      followPromptButtonLabel: followPromptButtonLabel || null,
      publicReplyEnabled,
      publicReplyMessages: publicReplyMessages.filter(Boolean),
      trackedDestinationUrl: trackedDestinationUrl || "",
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
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold">
            {mode === "new" ? "New Campaign" : "Edit Campaign"}
          </h1>
          <p className="text-sm text-muted">Atur komentar pemicu dan pertanyaan lead interaktif.</p>
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

      {/* 1. Basic Info */}
      <div className="panel rounded p-6 space-y-4">
        <h2 className="text-base font-semibold">1. Informasi Umum</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium mb-1">Nama Campaign</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Misal: Lead Form UC Online"
              className="w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Akun Instagram</label>
            <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Kata Kunci Komentar (pisahkan koma)</label>
          <input
            type="text"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="info, daftar, mau, kuliah"
            className="w-full rounded border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 2. Interactive Lead Form Builder */}
      <div className="panel rounded p-6 space-y-6 border-2 border-accent/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-accent">2. Interactive Lead Form Builder</h2>
            <p className="text-xs text-muted">
              Atur urutan pertanyaan dinamis. Jawaban user akan disimpan ke variabel terkait.
            </p>
          </div>
          <button
            type="button"
            onClick={addQuestion}
            className="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded hover:bg-accent-hover"
          >
            + Tambah Pertanyaan
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
                    onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIdx))}
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
                            onChange={() => {
                              setQuestions((prev) => {
                                const updated = [...prev];
                                updated[qIdx].type = "text";
                                return updated;
                              });
                            }}
                          />
                          Teks Manual
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`type_${q.id}`}
                            checked={q.type === "button"}
                            onChange={() => {
                              setQuestions((prev) => {
                                const updated = [...prev];
                                updated[qIdx].type = "button";
                                if (updated[qIdx].options.length === 0) updated[qIdx].options = [""];
                                return updated;
                              });
                            }}
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
                            onChange={(e) => {
                              const val = e.target.value;
                              setQuestions((prev) => {
                                const updated = [...prev];
                                updated[qIdx].options[optIdx] = val;
                                return updated;
                              });
                            }}
                            placeholder={`Pilihan ${optIdx + 1}`}
                            className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:border-accent"
                          />
                          {q.options.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setQuestions((prev) => {
                                  const updated = [...prev];
                                  updated[qIdx].options = updated[qIdx].options.filter((_, i) => i !== optIdx);
                                  return updated;
                                });
                              }}
                              className="text-xs text-red-400"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setQuestions((prev) => {
                            const updated = [...prev];
                            updated[qIdx].options.push("");
                            return updated;
                          });
                        }}
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