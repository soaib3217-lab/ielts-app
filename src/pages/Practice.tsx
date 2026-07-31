import { useEffect, useState } from 'react';
import { Volume2, CheckCircle2, BookOpen, BrainCircuit, CheckSquare, CalendarDays, FileDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ParsedLesson } from '../lib/pdfParser';

type ViewMode = 'archive' | 'vocab' | 'mcq' | 'tf' | 'pdf';

export default function Practice() {
  const [lessons, setLessons] = useState<(ParsedLesson & { id: string, day_number: number })[]>([]);
  const [currentLesson, setCurrentLesson] = useState<(ParsedLesson & { id: string, day_number: number }) | null>(null);
  const [view, setView] = useState<ViewMode>('archive');
  const [loading, setLoading] = useState(true);

  // Gamification state
  const [mcqScore, setMcqScore] = useState(0);
  const [mcqIndex, setMcqIndex] = useState(0);
  const [selectedMcq, setSelectedMcq] = useState<number | null>(null);

  const [tfAnswers, setTfAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchLessons();
  }, []);

  const fetchLessons = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('daily_lessons').select('*').order('day_number', { ascending: false });
    if (!error && data) {
      setLessons(data);
    }
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
    if (selectedMcq !== null) return;
    setSelectedMcq(idx);
    if (currentLesson && idx === currentLesson.mcq_data[mcqIndex].correct_index) {
      setMcqScore(s => s + 10);
    }
    setTimeout(() => {
      if (currentLesson && mcqIndex < currentLesson.mcq_data.length - 1) {
        setMcqIndex(i => i + 1);
        setSelectedMcq(null);
      }
    }, 1500);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse font-medium">Loading your lessons...</div>;
  }

  if (view === 'archive' || !currentLesson) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Daily Practice</h1>
          <p className="text-slate-400">Select a daily lesson to start your IELTS preparation.</p>
        </div>

        {lessons.length === 0 ? (
          <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 text-center text-slate-500">
            No lessons published yet. Go to the Admin portal to upload a PDF.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {lessons.map(lesson => (
              <div 
                key={lesson.id} 
                onClick={() => { setCurrentLesson(lesson); setView('vocab'); }}
                className="bg-white/[0.02] backdrop-blur-md rounded-2xl p-6 border border-white/[0.05] shadow-xl shadow-black/10 hover:bg-white/[0.04] transition-all cursor-pointer group hover:border-indigo-500/30"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full text-sm font-semibold">
                    Day {lesson.day_number}
                  </span>
                  <CalendarDays className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">{lesson.topic_title}</h3>
                <p className="text-slate-400 text-sm">{lesson.vocab_data.length} Words • {lesson.tf_data.length} Statements</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Lesson Header Nav */}
      <div className="flex items-center gap-4 border-b border-white/[0.05] pb-4 overflow-x-auto no-scrollbar">
        <button onClick={() => setView('archive')} className="text-slate-400 hover:text-white font-medium shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors">
          ← Archive
        </button>
        <div className="h-4 w-px bg-white/10"></div>
        <button onClick={() => setView('vocab')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'vocab' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <BookOpen className="w-4 h-4" /> Vocabulary
        </button>
        <button onClick={() => { setView('mcq'); setMcqIndex(0); setMcqScore(0); setSelectedMcq(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'mcq' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <BrainCircuit className="w-4 h-4" /> Gamified MCQ
        </button>
        <button onClick={() => setView('tf')} className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'tf' ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          <CheckSquare className="w-4 h-4" /> T/F/NG
        </button>
        
        {currentLesson.pdf_url && (
          <>
            <div className="h-4 w-px bg-slate-700"></div>
            <button 
              onClick={() => setView('pdf')}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all shrink-0 ${view === 'pdf' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <FileDown className="w-4 h-4" /> Original PDF
            </button>
          </>
        )}
      </div>

      {view === 'vocab' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {currentLesson.vocab_data.map((v, i) => (
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
              <p className="text-slate-300 font-medium text-lg leading-relaxed mb-4 flex-1 relative z-10">
                {v.definition}
              </p>
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
          {mcqIndex >= currentLesson.mcq_data.length ? (
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
          ) : (
            <div className="bg-white/[0.02] backdrop-blur-xl p-8 rounded-3xl border border-white/[0.05] shadow-2xl shadow-black/20 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                <div 
                  className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-300" 
                  style={{ width: `${(mcqIndex / currentLesson.mcq_data.length) * 100}%` }}
                ></div>
              </div>
              
              <div className="flex justify-between items-center mb-8">
                <span className="text-sm font-bold tracking-wider text-slate-400 uppercase">Question {mcqIndex + 1} of {currentLesson.mcq_data.length}</span>
                <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-4 py-1.5 rounded-full text-sm">Score: {mcqScore}</span>
              </div>
              
              <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight mb-8">
                <span dangerouslySetInnerHTML={{ __html: currentLesson.mcq_data[mcqIndex].question.replace(/\*\*(.*?)\*\*/, '<span class="text-indigo-400 font-extrabold">$1</span>') }} />
              </h3>
              
              <div className="space-y-3">
                {currentLesson.mcq_data[mcqIndex].options.map((opt, idx) => {
                  const isSelected = selectedMcq === idx;
                  const isCorrect = idx === currentLesson.mcq_data[mcqIndex].correct_index;
                  
                  let btnClass = "w-full text-left p-4 rounded-xl border-2 font-medium transition-all duration-200 text-lg ";
                  
                  if (selectedMcq === null) {
                    btnClass += "border-white/[0.05] hover:border-indigo-500/30 hover:bg-white/[0.04] text-slate-300";
                  } else {
                    if (isCorrect) btnClass += "border-emerald-500/50 bg-emerald-500/10 text-emerald-400";
                    else if (isSelected && !isCorrect) btnClass += "border-rose-500/50 bg-rose-500/10 text-rose-400";
                    else btnClass += "border-white/[0.02] bg-transparent text-slate-500 opacity-50";
                  }

                  return (
                    <button 
                      key={idx} 
                      disabled={selectedMcq !== null}
                      onClick={() => handleMcqSelect(idx)}
                      className={btnClass}
                    >
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
              <BookOpen className="w-5 h-5 text-sky-400" />
              Reading Passage
            </h3>
            <div className="prose prose-invert prose-slate max-w-none text-slate-300 leading-relaxed">
              {currentLesson.reading_passage ? (
                currentLesson.reading_passage.split('\n').map((p, i) => <p key={i} className="mb-4">{p}</p>)
              ) : (
                <p className="italic text-slate-500">No reading passage extracted for this lesson.</p>
              )}
            </div>
          </div>
          
          <div className="bg-white/[0.01] rounded-2xl p-6 overflow-y-auto border border-white/[0.02]">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-sky-400" />
              Statements
            </h3>
            <div className="space-y-6">
              {currentLesson.tf_data.map((tf) => {
                const ans = tfAnswers[tf.id];
                const isChecked = ans !== undefined;
                const isCorrect = ans === tf.correct_answer;

                return (
                  <div key={tf.id} className="bg-white/[0.02] backdrop-blur-sm p-5 rounded-xl border border-white/[0.05] shadow-lg shadow-black/5">
                    <p className="font-medium text-slate-200 mb-4 text-lg">
                      <span className="text-indigo-400/80 mr-2 font-bold">{tf.id}.</span> 
                      {tf.statement}
                    </p>
                    <div className="flex gap-3">
                      {['True', 'False', 'Not Given'].map(opt => (
                        <button
                          key={opt}
                          disabled={isChecked}
                          onClick={() => setTfAnswers(prev => ({ ...prev, [tf.id]: opt }))}
                          className={`flex-1 py-2 rounded-lg font-semibold transition-all duration-200 border-2 ${
                            !isChecked 
                              ? 'border-white/[0.05] text-slate-400 hover:bg-white/[0.04] hover:border-sky-500/30 hover:text-white' 
                              : ans === opt
                                ? isCorrect 
                                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                                  : 'border-rose-500/50 bg-rose-500/10 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
                                : opt === tf.correct_answer
                                  ? 'border-emerald-500/50 text-emerald-400 border-dashed bg-emerald-500/5'
                                  : 'border-transparent bg-black/20 text-slate-600'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {currentLesson.tf_data.length === 0 && (
                <p className="text-slate-500 text-center">No True/False/Not Given statements found.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {view === 'pdf' && currentLesson.pdf_url && (
        <div className="h-[calc(100vh-200px)] w-full rounded-2xl overflow-hidden border border-white/[0.05] shadow-xl shadow-black/20 bg-white/5 backdrop-blur-sm">
          <iframe 
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(currentLesson.pdf_url)}&embedded=true`} 
            className="w-full h-full"
            title="Original PDF"
          />
        </div>
      )}
    </div>
  );
}
