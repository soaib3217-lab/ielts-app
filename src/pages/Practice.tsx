import { useEffect, useState, useMemo, useRef } from 'react';
import { Volume2, CheckCircle2, BookOpen, BrainCircuit, CheckSquare, CalendarDays, FileDown, Edit3, Mic, Square, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ParsedLesson, ParsedWeeklyPractice } from '../lib/pdfParser';
import { evaluateSpeakingPractice, type SpeakingEvaluation } from '../lib/geminiService';

type ViewMode = 'archive' | 'vocab' | 'mcq' | 'tf' | 'pdf' | 'weekly_vocab' | 'weekly_reading' | 'weekly_speaking' | 'weekly_writing';

type DailyItem = ParsedLesson & { id: string, day_number: number, type: 'daily' };
type WeeklyItem = ParsedWeeklyPractice & { id: string, week_number: number, type: 'weekly' };
type PracticeItem = DailyItem | WeeklyItem;

export default function Practice() {
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<PracticeItem | null>(null);
  const [view, setView] = useState<ViewMode>('archive');
  const [loading, setLoading] = useState(true);
  const [archiveTab, setArchiveTab] = useState<'all' | 'daily' | 'weekly'>('all');

  // Daily gamification state
  const [mcqScore, setMcqScore] = useState(0);
  const [mcqIndex, setMcqIndex] = useState(0);
  const [mcqAnswers, setMcqAnswers] = useState<Record<number, number>>({});
  const [mcqFinished, setMcqFinished] = useState(false);
  const [tfAnswers, setTfAnswers] = useState<Record<number, string>>({});

  // Weekly gamification state
  const [fillBlankAnswers, setFillBlankAnswers] = useState<Record<number, string>>({});
  const [synonymAnswers, setSynonymAnswers] = useState<Record<number, string>>({});

  // Speaking Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationFeedback, setEvaluationFeedback] = useState<SpeakingEvaluation | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string | null>(null);

  const shuffledWordBank = useMemo(() => {
    if (selectedItem?.type === 'weekly' && selectedItem.fill_blanks_data) {
      return [...selectedItem.fill_blanks_data.word_bank].sort(() => Math.random() - 0.5);
    }
    return [];
  }, [selectedItem]);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    setLoading(true);
    const [dailyRes, weeklyRes] = await Promise.all([
      supabase.from('daily_lessons').select('*').order('day_number', { ascending: false }),
      supabase.from('weekly_practices').select('*').order('week_number', { ascending: false })
    ]);

    const combined: PracticeItem[] = [];
    if (!dailyRes.error && dailyRes.data) {
      combined.push(...dailyRes.data.map(d => ({ ...d, type: 'daily' as const })));
    }
    if (!weeklyRes.error && weeklyRes.data) {
      combined.push(...weeklyRes.data.map(w => ({ ...w, type: 'weekly' as const })));
    }

    // Sort by created_at or just leave them grouped. Let's sort by date roughly if they had a shared key.
    // For now, daily first, then weekly.
    setItems(combined);
    setLoading(false);
  };

  const playAudio = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleMcqSelect = (idx: number) => {
    if (mcqFinished || mcqAnswers[mcqIndex] !== undefined || !selectedItem || selectedItem.type !== 'daily') return;
    
    setMcqAnswers(prev => ({ ...prev, [mcqIndex]: idx }));
    
    setTimeout(() => {
      if (mcqIndex < selectedItem.mcq_data.length - 1) {
        setMcqIndex(i => i + 1);
      } else {
        setMcqFinished(true);
        // Calculate final score
        let score = 0;
        selectedItem.mcq_data.forEach((q, i) => {
          const ans = i === mcqIndex ? idx : mcqAnswers[i];
          if (ans === q.correct_index) {
            score += 10;
          }
        });
        setMcqScore(score);
      }
    }, 400);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioMimeType(mediaRecorder.mimeType);

        // Convert blob to base64 for Gemini
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          setAudioBase64(base64data);
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
      setAudioUrl(null);
      setEvaluationFeedback(null);
    } catch (err) {
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleEvaluateSpeaking = async () => {
    if (!audioBase64 || !audioMimeType || selectedItem?.type !== 'weekly') return;
    
    let keyToUse = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('gemini_api_key');
    if (!keyToUse) {
      if (!apiKeyInput) {
        alert("Please enter your Gemini API Key first.");
        return;
      }
      keyToUse = apiKeyInput;
      localStorage.setItem('gemini_api_key', keyToUse);
    }

    setIsEvaluating(true);
    try {
      const data = selectedItem.listening_speaking_data;
      const feedback = await evaluateSpeakingPractice(
        audioBase64,
        audioMimeType,
        data.speaking_prompt,
        data.speaking_bullet_points,
        keyToUse
      );
      setEvaluationFeedback(feedback);
    } catch (err: any) {
      alert(err.message || "Failed to evaluate speaking.");
      if (err.message && err.message.toLowerCase().includes("api key")) {
        localStorage.removeItem('gemini_api_key');
      }
    } finally {
      setIsEvaluating(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">Loading your practice materials...</div>;
  }

  if (view === 'archive' || !selectedItem) {
    return (
      <div className="space-y-12">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Practice Hub</h1>
          <p className="text-slate-400 mb-6">Select a daily lesson or a weekly review to start your IELTS preparation.</p>
          
          <div className="flex items-center gap-3 border-b border-white/[0.05] pb-4">
            <button onClick={() => setArchiveTab('all')} className={`px-5 py-2 rounded-full font-medium transition-all ${archiveTab === 'all' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>All</button>
            <button onClick={() => setArchiveTab('daily')} className={`px-5 py-2 rounded-full font-medium transition-all ${archiveTab === 'daily' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>Daily Lessons</button>
            <button onClick={() => setArchiveTab('weekly')} className={`px-5 py-2 rounded-full font-medium transition-all ${archiveTab === 'weekly' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>Weekly Practice</button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 text-center text-slate-500">
            No practices published yet. Go to the Admin portal to upload a PDF.
          </div>
        ) : (
          <div className="space-y-12 mt-6">
            {(archiveTab === 'all' || archiveTab === 'daily') && items.filter(item => item.type === 'daily').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Daily Lessons</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.filter(item => item.type === 'daily').map(item => (
                    <div 
                      key={item.id} 
                      onClick={() => { 
                        setSelectedItem(item); 
                        setView('vocab');
                        // Reset states
                        setFillBlankAnswers({});
                        setSynonymAnswers({});
                        setTfAnswers({});
                        setMcqAnswers({});
                        setMcqFinished(false);
                        setMcqIndex(0);
                        setMcqScore(0);
                      }}
                      className="bg-white/[0.02] backdrop-blur-md rounded-2xl p-6 border shadow-xl shadow-black/10 hover:bg-white/[0.04] transition-all cursor-pointer group border-indigo-500/10 hover:border-indigo-500/30"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="px-3 py-1 rounded-full text-sm font-semibold border bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                          Day {(item as DailyItem).day_number}
                        </span>
                        <CalendarDays className="w-5 h-5 transition-colors text-slate-500 group-hover:text-indigo-400" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">{item.topic_title}</h3>
                      <p className="text-slate-400 text-sm">
                        {(item as DailyItem).vocab_data.length} Words • {(item as DailyItem).tf_data.length} Statements
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {(archiveTab === 'all' || archiveTab === 'weekly') && items.filter(item => item.type === 'weekly').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Weekly Practice</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {items.filter(item => item.type === 'weekly').map(item => (
                    <div 
                      key={item.id} 
                      onClick={() => { 
                        setSelectedItem(item); 
                        setView('weekly_vocab');
                        // Reset states
                        setFillBlankAnswers({});
                        setSynonymAnswers({});
                        setTfAnswers({});
                      }}
                      className="bg-white/[0.02] backdrop-blur-md rounded-2xl p-6 border shadow-xl shadow-black/10 hover:bg-white/[0.04] transition-all cursor-pointer group border-cyan-500/10 hover:border-cyan-500/30"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="px-3 py-1 rounded-full text-sm font-semibold border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                          Week {(item as WeeklyItem).week_number} Review
                        </span>
                        <CalendarDays className="w-5 h-5 transition-colors text-slate-500 group-hover:text-cyan-400" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">{item.topic_title}</h3>
                      <p className="text-slate-400 text-sm">
                        Comprehensive Weekly Review
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- DAILY LESSON VIEWS ---
  if (selectedItem.type === 'daily') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 border-b border-white/[0.05] pb-4 overflow-x-auto no-scrollbar">
          <button onClick={() => setView('archive')} className="text-slate-400 hover:text-white font-medium shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors">
            ← Archive
          </button>
          <div className="h-4 w-px bg-white/10"></div>
          <button onClick={() => setView('vocab')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'vocab' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <BookOpen className="w-4 h-4" /> Vocabulary
          </button>
          <button onClick={() => { setView('mcq'); setMcqIndex(0); setMcqScore(0); setMcqAnswers({}); setMcqFinished(false); }} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'mcq' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <BrainCircuit className="w-4 h-4" /> Gamified MCQ
          </button>
          <button onClick={() => setView('tf')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'tf' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <CheckSquare className="w-4 h-4" /> T/F/NG
          </button>
          
          {selectedItem.pdf_url && (
            <>
              <div className="h-4 w-px bg-slate-700"></div>
              <button onClick={() => setView('pdf')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'pdf' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <FileDown className="w-4 h-4" /> Original PDF
              </button>
            </>
          )}
        </div>

        {view === 'vocab' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {selectedItem.vocab_data.map((v, i) => (
              <div key={i} className="bg-white/[0.02] backdrop-blur-md p-6 rounded-2xl shadow-xl shadow-black/10 border border-white/[0.05] flex flex-col group relative overflow-hidden transition-colors hover:bg-white/[0.03]">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[40px] -mr-8 -mt-8 rounded-full pointer-events-none"></div>
                <div className="flex items-start justify-between mb-4 relative z-10">
                  <div>
                    <h3 className="text-2xl font-bold text-white flex items-center gap-3">
                      {v.word}
                      <button onClick={() => playAudio(v.word)} className="p-1.5 bg-white/5 hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-400 rounded-full transition-all border border-white/5 hover:border-indigo-500/30">
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </h3>
                    <span className="text-xs font-semibold tracking-wider text-indigo-400 uppercase mt-1 block">{v.level}</span>
                  </div>
                  <button className="text-slate-600 hover:text-emerald-500 transition-colors" title="Mark Mastered">
                    <CheckCircle2 className="w-7 h-7" />
                  </button>
                </div>
                <p className="text-slate-300 font-medium text-lg leading-relaxed mb-4 flex-1 relative z-10">{v.definition}</p>
                {v.example && (
                  <div className="bg-black/20 p-4 rounded-xl text-slate-400 italic border border-white/[0.03] relative z-10">
                    "{v.example}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {view === 'mcq' && (
          <div className="max-w-2xl mx-auto mt-12">
            {mcqFinished ? (
              <div className="space-y-8 pb-12">
                <div className="text-center p-12 bg-white/[0.02] backdrop-blur-md rounded-3xl border border-white/[0.05] shadow-2xl shadow-black/20 relative overflow-hidden">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-emerald-500/20 blur-[80px] rounded-full pointer-events-none"></div>
                  <div className="relative z-10">
                    <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/10">
                      <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-2">Quiz Completed!</h2>
                    <p className="text-slate-400 text-lg mb-8">You scored <span className="font-bold text-emerald-400">{mcqScore}</span> points.</p>
                    <button onClick={() => setView('archive')} className="bg-indigo-500 text-white px-8 py-3 rounded-full font-medium hover:bg-indigo-600 shadow-lg shadow-indigo-500/25 transition-all">
                      Back to Lessons
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-white">Review Your Answers</h3>
                  {selectedItem.mcq_data.map((q, i) => {
                    const userAnswerIdx = mcqAnswers[i];
                    const isCorrect = userAnswerIdx === q.correct_index;
                    return (
                      <div key={i} className={`p-6 rounded-2xl border ${isCorrect ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-rose-500/5 border-rose-500/20'}`}>
                        <p className="text-lg text-white font-medium mb-4">
                          <span className="text-slate-400 mr-2">{i + 1}.</span> 
                          <span dangerouslySetInnerHTML={{ __html: q.question.replace(/\*\*(.*?)\*\*/g, '<span class="text-indigo-400 font-bold">$1</span>') }} />
                        </p>
                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => {
                            const isUserAns = optIdx === userAnswerIdx;
                            const isCorrectAns = optIdx === q.correct_index;
                            let style = "p-3 rounded-lg border ";
                            if (isCorrectAns) {
                              style += "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 font-medium";
                            } else if (isUserAns && !isCorrectAns) {
                              style += "border-rose-500/50 bg-rose-500/10 text-rose-400 font-medium";
                            } else {
                              style += "border-white/5 text-slate-400";
                            }
                            return (
                              <div key={optIdx} className={style}>
                                {opt}
                                {isCorrectAns && <span className="ml-2 text-sm opacity-80">(Correct Answer)</span>}
                                {isUserAns && !isCorrectAns && <span className="ml-2 text-sm opacity-80">(Your Answer)</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white/[0.02] backdrop-blur-xl p-8 rounded-3xl border border-white/[0.05] shadow-2xl shadow-black/20 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                  <div className="h-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-300" style={{ width: `${(mcqIndex / selectedItem.mcq_data.length) * 100}%` }}></div>
                </div>
                <div className="flex justify-between items-center mb-8">
                  <span className="text-sm font-bold tracking-wider text-slate-400 uppercase">Question {mcqIndex + 1} of {selectedItem.mcq_data.length}</span>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-8">
                  <span dangerouslySetInnerHTML={{ __html: selectedItem.mcq_data[mcqIndex].question.replace(/\*\*(.*?)\*\*/, '<span class="text-indigo-400 font-extrabold">$1</span>') }} />
                </h3>
                <div className="space-y-3">
                  {selectedItem.mcq_data[mcqIndex].options.map((opt, idx) => {
                    const isSelected = mcqAnswers[mcqIndex] === idx;
                    let btnClass = "w-full text-left p-4 rounded-xl border-2 font-medium transition-all duration-200 text-lg ";
                    if (!isSelected) {
                      btnClass += "border-white/[0.05] hover:border-indigo-500/30 hover:bg-white/[0.04] text-slate-300";
                    } else {
                      btnClass += "border-indigo-500/50 bg-indigo-500/10 text-indigo-400";
                    }
                    return (
                      <button key={idx} disabled={mcqAnswers[mcqIndex] !== undefined} onClick={() => handleMcqSelect(idx)} className={btnClass}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'tf' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-200px)]">
            <div className="bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/[0.05] p-6 overflow-y-auto shadow-xl shadow-black/10">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-sky-400" /> Reading Passage
              </h3>
              <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed">
                {selectedItem.reading_passage ? (
                  selectedItem.reading_passage.split('\n').map((p, i) => <p key={i} className="mb-4">{p}</p>)
                ) : (
                  <p className="italic text-slate-500">No reading passage extracted for this lesson.</p>
                )}
              </div>
            </div>
            
            <div className="bg-white/[0.01] rounded-2xl p-6 overflow-y-auto border border-white/[0.02]">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-sky-400" /> Statements
              </h3>
              <div className="space-y-6">
                {selectedItem.tf_data.map((tf) => {
                  const ans = tfAnswers[tf.id];
                  const isChecked = ans !== undefined;
                  const isCorrect = ans === tf.correct_answer;
                  return (
                    <div key={tf.id} className="bg-white/[0.02] backdrop-blur-sm p-5 rounded-xl border border-white/[0.05] shadow-lg shadow-black/5">
                      <p className="font-medium text-slate-200 mb-4 text-lg">
                        <span className="text-indigo-400/80 mr-2 font-bold">{tf.id}.</span> {tf.statement}
                      </p>
                      <div className="flex gap-3">
                        {['True', 'False', 'Not Given'].map(opt => (
                          <button key={opt} disabled={isChecked} onClick={() => setTfAnswers(prev => ({ ...prev, [tf.id]: opt }))}
                            className={`flex-1 py-2 rounded-lg font-semibold transition-all duration-200 border-2 ${!isChecked ? 'border-white/[0.05] text-slate-400 hover:bg-white/[0.04] hover:border-sky-500/30 hover:text-white' : ans === opt ? isCorrect ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : 'border-rose-500/50 bg-rose-500/10 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : opt === tf.correct_answer ? 'border-emerald-500/50 text-emerald-400 border-dashed bg-emerald-500/5' : 'border-transparent bg-black/20 text-slate-600'}`}
                          >{opt}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === 'pdf' && selectedItem.pdf_url && (
          <div className="h-[calc(100vh-200px)] w-full rounded-2xl overflow-hidden border border-white/[0.05] shadow-xl shadow-black/20 bg-white/5 backdrop-blur-sm">
            <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(selectedItem.pdf_url)}&embedded=true`} className="w-full h-full" title="Original PDF" />
          </div>
        )}
      </div>
    );
  }

  // --- WEEKLY REVIEW VIEWS ---
  if (selectedItem.type === 'weekly') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 border-b border-white/[0.05] pb-4 overflow-x-auto no-scrollbar">
          <button onClick={() => setView('archive')} className="text-slate-400 hover:text-white font-medium shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors">
            ← Archive
          </button>
          <div className="h-4 w-px bg-white/10"></div>
          <button onClick={() => setView('weekly_vocab')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'weekly_vocab' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <BookOpen className="w-4 h-4" /> Vocab Recall
          </button>
          <button onClick={() => setView('weekly_reading')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'weekly_reading' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <CheckSquare className="w-4 h-4" /> Active Reading
          </button>
          <button onClick={() => setView('weekly_speaking')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'weekly_speaking' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <Mic className="w-4 h-4" /> Listening & Speaking
          </button>
          <button onClick={() => setView('weekly_writing')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'weekly_writing' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
            <Edit3 className="w-4 h-4" /> Writing
          </button>
          
          {selectedItem.pdf_url && (
            <>
              <div className="h-4 w-px bg-slate-700"></div>
              <button onClick={() => setView('pdf')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'pdf' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <FileDown className="w-4 h-4" /> Original PDF
              </button>
            </>
          )}
        </div>

        {view === 'weekly_vocab' && (
          <div className="space-y-8">
            <div className="bg-white/[0.02] backdrop-blur-md rounded-3xl p-8 border border-white/[0.05] shadow-xl shadow-black/10">
              <h2 className="text-2xl font-bold text-white mb-6">Fill in the Blanks</h2>
              <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-8 flex flex-wrap gap-3 items-center">
                <span className="text-indigo-400 font-bold mr-2">Word Bank:</span>
                {shuffledWordBank.map(w => (
                  <span key={w} className="bg-white/5 border border-white/10 px-3 py-1 rounded-lg text-slate-300 font-medium">{w}</span>
                ))}
              </div>
              
              <div className="space-y-6">
                {selectedItem.fill_blanks_data.sentences.map((s, i) => {
                  const val = fillBlankAnswers[i] || '';
                  const isCorrect = val.toLowerCase() === s.answer.toLowerCase();
                  return (
                    <div key={i} className="text-lg text-slate-300 leading-relaxed">
                      <span className="text-slate-500 font-medium mr-3">{i + 1}.</span>
                      {s.text_before}
                      <select 
                        className={`mx-2 bg-black/20 border-b-2 outline-none font-semibold text-center appearance-none px-4 py-1 rounded-t-md transition-colors ${val === '' ? 'border-indigo-500/50 text-indigo-400' : isCorrect ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10' : 'border-rose-500 text-rose-400 bg-rose-500/10'}`}
                        value={val}
                        onChange={(e) => setFillBlankAnswers(p => ({ ...p, [i]: e.target.value }))}
                      >
                        <option value="">________</option>
                        {shuffledWordBank.map(w => <option key={w} value={w}>{w}</option>)}
                      </select>
                      {s.text_after}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white/[0.02] backdrop-blur-md rounded-3xl p-8 border border-white/[0.05] shadow-xl shadow-black/10">
              <h2 className="text-2xl font-bold text-white mb-6">Synonym Matching</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedItem.synonym_data.map((syn, i) => {
                  const val = synonymAnswers[i] || '';
                  const isCorrect = val === syn.synonym;
                  return (
                    <div key={i} className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/5">
                      <span className="font-bold text-lg text-white">{syn.target}</span>
                      <select
                        className={`bg-black/30 border rounded-lg px-3 py-2 outline-none text-sm font-medium w-48 ${val === '' ? 'border-white/10 text-slate-400' : isCorrect ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-rose-500/50 text-rose-400 bg-rose-500/10'}`}
                        value={val}
                        onChange={(e) => setSynonymAnswers(p => ({ ...p, [i]: e.target.value }))}
                      >
                        <option value="">Select Synonym...</option>
                        {/* Randomize the display of synonyms by mapping all synonyms. For a real app, this should be shuffled once on load. */}
                        {[...selectedItem.synonym_data].map(sd => sd.synonym).sort().map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === 'weekly_reading' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-200px)]">
            <div className="bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/[0.05] p-6 overflow-y-auto shadow-xl shadow-black/10">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-400" /> Reading Passage
              </h3>
              <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed">
                {selectedItem.reading_passage ? (
                  selectedItem.reading_passage.split('\n').map((p, i) => <p key={i} className="mb-4">{p}</p>)
                ) : (
                  <p className="italic text-slate-500">No reading passage extracted.</p>
                )}
              </div>
            </div>
            
            <div className="bg-white/[0.01] rounded-2xl p-6 overflow-y-auto border border-white/[0.02]">
              <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <CheckSquare className="w-5 h-5 text-emerald-400" /> TFNG Statements
              </h3>
              <div className="space-y-6">
                {selectedItem.tfng_data.map((tf) => {
                  const ans = tfAnswers[tf.id];
                  const isChecked = ans !== undefined;
                  const isCorrect = ans === tf.correct_answer;
                  return (
                    <div key={tf.id} className="bg-white/[0.02] backdrop-blur-sm p-5 rounded-xl border border-white/[0.05] shadow-lg shadow-black/5">
                      <p className="font-medium text-slate-200 mb-4 text-lg">
                        <span className="text-emerald-400/80 mr-2 font-bold">{tf.id}.</span> {tf.statement}
                      </p>
                      <div className="flex gap-3">
                        {['True', 'False', 'Not Given'].map(opt => (
                          <button key={opt} disabled={isChecked} onClick={() => setTfAnswers(prev => ({ ...prev, [tf.id]: opt }))}
                            className={`flex-1 py-2 rounded-lg font-semibold transition-all duration-200 border-2 ${!isChecked ? 'border-white/[0.05] text-slate-400 hover:bg-white/[0.04] hover:border-emerald-500/30 hover:text-white' : ans === opt ? isCorrect ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : 'border-rose-500/50 bg-rose-500/10 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : opt === tf.correct_answer ? 'border-emerald-500/50 text-emerald-400 border-dashed bg-emerald-500/5' : 'border-transparent bg-black/20 text-slate-600'}`}
                          >{opt}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === 'weekly_speaking' && (
          <div className="max-w-3xl mx-auto space-y-8 mt-4">
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 p-8 rounded-3xl border border-amber-500/20 shadow-xl shadow-amber-500/5">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                <Volume2 className="w-6 h-6 text-amber-400" /> Active Listening Task
              </h2>
              <p className="text-lg text-amber-100/80 leading-relaxed font-medium">
                {selectedItem.listening_speaking_data.listening_instructions}
              </p>
            </div>
            
            <div className="bg-white/[0.02] backdrop-blur-md p-8 rounded-3xl border border-white/[0.05] shadow-xl shadow-black/10">
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <Mic className="w-6 h-6 text-indigo-400" /> Speaking Practice
              </h2>
              <div className="bg-black/20 p-6 rounded-2xl border border-white/[0.03] mb-6">
                <p className="text-xl font-medium text-slate-200 mb-6 italic">"{selectedItem.listening_speaking_data.speaking_prompt}"</p>
                <div className="space-y-3">
                  <p className="text-indigo-400 font-bold text-sm uppercase tracking-wider">You should say:</p>
                  <ul className="space-y-2">
                    {selectedItem.listening_speaking_data.speaking_bullet_points.map((bp, i) => (
                      <li key={i} className="flex items-start gap-3 text-slate-300 text-lg">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full mt-2.5 shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></span>
                        {bp}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex flex-col gap-6 border-t border-white/[0.05] pt-6 mt-6">
                <div className="flex justify-between items-center">
                  {!isRecording && !audioUrl && (
                    <button onClick={startRecording} className="bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-8 py-3 rounded-full flex items-center gap-3 shadow-lg shadow-indigo-500/25 transition-all w-full justify-center text-lg">
                      <Mic className="w-6 h-6" /> Start Recording
                    </button>
                  )}
                  {isRecording && (
                    <button onClick={stopRecording} className="bg-rose-500 hover:bg-rose-600 text-white font-medium px-8 py-3 rounded-full flex items-center gap-3 shadow-lg shadow-rose-500/25 transition-all w-full justify-center text-lg animate-pulse">
                      <Square className="w-6 h-6" fill="currentColor" /> Stop Recording
                    </button>
                  )}
                </div>

                {audioUrl && (
                  <div className="bg-white/5 p-6 rounded-2xl border border-white/10 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <audio src={audioUrl} controls className="w-full h-12 outline-none" />
                      <button onClick={startRecording} className="text-slate-400 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5 transition-all shrink-0">
                        Rerecord
                      </button>
                    </div>
                    
                    {(!import.meta.env.VITE_GEMINI_API_KEY && !localStorage.getItem('gemini_api_key')) && !evaluationFeedback && (
                      <div className="flex items-center gap-3 bg-black/20 p-3 rounded-xl border border-white/5">
                        <input 
                          type="password" 
                          placeholder="Enter Gemini API Key..." 
                          className="bg-transparent outline-none text-slate-200 w-full px-2"
                          value={apiKeyInput}
                          onChange={e => setApiKeyInput(e.target.value)}
                        />
                      </div>
                    )}

                    {!evaluationFeedback && (
                      <button onClick={handleEvaluateSpeaking} disabled={isEvaluating} className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:hover:bg-emerald-500 text-white font-medium px-6 py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all">
                        {isEvaluating ? <><Loader2 className="w-5 h-5 animate-spin" /> Evaluating with AI...</> : <><BrainCircuit className="w-5 h-5" /> Get AI Feedback</>}
                      </button>
                    )}
                  </div>
                )}

                {evaluationFeedback && (
                  <div className="bg-white/[0.03] p-8 rounded-3xl border border-emerald-500/20 shadow-xl shadow-emerald-500/10 space-y-8 animate-in fade-in slide-in-from-bottom-4">
                    <div className="text-center pb-6 border-b border-white/5">
                      <h3 className="text-3xl font-bold text-white mb-2">Overall Band Score: <span className="text-emerald-400">{evaluationFeedback.overall_band.toFixed(1)}</span></h3>
                      <p className="text-slate-400">Evaluated by Gemini AI based on official IELTS criteria</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-semibold text-slate-200">Fluency & Coherence</h4>
                          <span className="bg-emerald-500/20 text-emerald-400 font-bold px-3 py-1 rounded-full">{evaluationFeedback.fluency_and_coherence.score}</span>
                        </div>
                        <p className="text-slate-400 text-sm leading-relaxed">{evaluationFeedback.fluency_and_coherence.feedback}</p>
                      </div>
                      
                      <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-semibold text-slate-200">Lexical Resource</h4>
                          <span className="bg-sky-500/20 text-sky-400 font-bold px-3 py-1 rounded-full">{evaluationFeedback.lexical_resource.score}</span>
                        </div>
                        <p className="text-slate-400 text-sm leading-relaxed">{evaluationFeedback.lexical_resource.feedback}</p>
                      </div>
                      
                      <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-semibold text-slate-200">Grammatical Range</h4>
                          <span className="bg-indigo-500/20 text-indigo-400 font-bold px-3 py-1 rounded-full">{evaluationFeedback.grammatical_range.score}</span>
                        </div>
                        <p className="text-slate-400 text-sm leading-relaxed">{evaluationFeedback.grammatical_range.feedback}</p>
                      </div>

                      <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-semibold text-slate-200">Pronunciation</h4>
                          <span className="bg-purple-500/20 text-purple-400 font-bold px-3 py-1 rounded-full">{evaluationFeedback.pronunciation.score}</span>
                        </div>
                        <p className="text-slate-400 text-sm leading-relaxed">{evaluationFeedback.pronunciation.feedback}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-emerald-500/5 border border-emerald-500/20 p-5 rounded-2xl">
                        <h4 className="font-bold text-emerald-400 mb-3 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Strengths</h4>
                        <ul className="space-y-2">
                          {evaluationFeedback.key_strengths.map((s, idx) => (
                            <li key={idx} className="text-emerald-100/70 text-sm flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span> {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      
                      <div className="bg-rose-500/5 border border-rose-500/20 p-5 rounded-2xl">
                        <h4 className="font-bold text-rose-400 mb-3 flex items-center gap-2"><Edit3 className="w-5 h-5" /> Areas for Improvement</h4>
                        <ul className="space-y-2">
                          {evaluationFeedback.areas_for_improvement.map((s, idx) => (
                            <li key={idx} className="text-rose-100/70 text-sm flex items-start gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0"></span> {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="bg-black/20 p-5 rounded-2xl border border-white/5">
                      <h4 className="font-semibold text-slate-200 mb-3">AI Transcription</h4>
                      <p className="text-slate-400 text-sm italic leading-relaxed">"{evaluationFeedback.transcription}"</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'weekly_writing' && (
          <div className="max-w-4xl mx-auto mt-4 h-[calc(100vh-150px)] flex flex-col">
            <div className="bg-purple-500/10 border border-purple-500/20 p-6 rounded-3xl mb-6 shadow-xl shadow-purple-500/5 shrink-0">
              <h2 className="text-xl font-bold text-white mb-3 flex items-center gap-3">
                <Edit3 className="w-6 h-6 text-purple-400" /> Journal Entry Prompt
              </h2>
              <p className="text-lg text-purple-100/80 leading-relaxed font-medium">
                {selectedItem.writing_prompt}
              </p>
            </div>
            
            <div className="flex-1 bg-white/[0.02] backdrop-blur-md rounded-3xl border border-white/[0.05] shadow-xl shadow-black/10 overflow-hidden flex flex-col">
              <textarea 
                className="w-full h-full bg-transparent p-8 text-lg text-slate-200 placeholder-slate-600 outline-none resize-none"
                placeholder="Start writing your essay or journal entry here..."
              ></textarea>
              <div className="bg-black/30 p-4 border-t border-white/[0.05] flex justify-between items-center shrink-0">
                <span className="text-slate-500 text-sm font-medium">Auto-saving locally...</span>
                <button className="bg-purple-500 hover:bg-purple-600 text-white font-medium px-6 py-2 rounded-full shadow-lg shadow-purple-500/20 transition-all">
                  Submit for Feedback (Demo)
                </button>
              </div>
            </div>
          </div>
        )}
        
        {view === 'pdf' && selectedItem.pdf_url && (
          <div className="h-[calc(100vh-200px)] w-full rounded-2xl overflow-hidden border border-white/[0.05] shadow-xl shadow-black/20 bg-white/5 backdrop-blur-sm">
            <iframe src={`https://docs.google.com/viewer?url=${encodeURIComponent(selectedItem.pdf_url)}&embedded=true`} className="w-full h-full" title="Original PDF" />
          </div>
        )}
      </div>
    );
  }

  return null;
}
