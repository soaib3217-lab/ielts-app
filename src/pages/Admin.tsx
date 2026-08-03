import React, { useState, useCallback, useEffect } from 'react';
import { UploadCloud, CheckCircle, FileText, Settings, Key, Calendar, CalendarDays } from 'lucide-react';
import { extractRawTextFromPDF, type ParsedLesson, type ParsedWeeklyPractice } from '../lib/pdfParser';
import { extractDataWithGemini, extractWeeklyDataWithGemini } from '../lib/geminiService';
import { supabase } from '../lib/supabase';

export default function Admin() {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  
  const [docType, setDocType] = useState<'daily' | 'weekly'>('daily');
  const [docNumber, setDocNumber] = useState(1);
  
  const [parsedData, setParsedData] = useState<ParsedLesson | null>(null);
  const [parsedWeeklyData, setParsedWeeklyData] = useState<ParsedWeeklyPractice | null>(null);
  
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState('');

  useEffect(() => {
    const envKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (envKey) {
      setApiKey(envKey);
    } else {
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) setApiKey(savedKey);
    }
  }, []);

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (!apiKey) {
      alert('Please enter your Gemini API Key first.');
      return;
    }

    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      await processFile(file);
    } else {
      alert('Please upload a valid PDF file.');
    }
  }, [apiKey, docType]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!apiKey) {
      alert('Please enter your Gemini API Key first.');
      return;
    }

    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setIsParsing(true);
    setPublishSuccess(false);
    setPdfFile(file);
    setParsedData(null);
    setParsedWeeklyData(null);
    try {
      const rawText = await extractRawTextFromPDF(file);
      if (docType === 'daily') {
        const data = await extractDataWithGemini(rawText, apiKey);
        setParsedData(data);
      } else {
        const data = await extractWeeklyDataWithGemini(rawText, apiKey);
        setParsedWeeklyData(data);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to parse PDF using Gemini AI. Check console for details.');
    } finally {
      setIsParsing(false);
    }
  };

  const handlePublish = async () => {
    if (!parsedData && !parsedWeeklyData) return;
    setIsPublishing(true);
    try {
      let pdfUrl = null;
      if (pdfFile) {
        const fileExt = pdfFile.name.split('.').pop();
        const prefix = docType === 'daily' ? 'day' : 'week';
        const fileName = `${prefix}-${docNumber}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('ielts-pdfs')
          .upload(fileName, pdfFile, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('ielts-pdfs')
          .getPublicUrl(fileName);

        pdfUrl = publicUrl;
      }

      if (docType === 'daily' && parsedData) {
        const { error } = await supabase.from('daily_lessons').upsert({
          day_number: docNumber,
          topic_title: parsedData.topic_title,
          vocab_data: parsedData.vocab_data,
          reading_passage: parsedData.reading_passage,
          tf_data: parsedData.tf_data,
          mcq_data: parsedData.mcq_data,
          pdf_url: pdfUrl
        }, { onConflict: 'day_number' });
        if (error) throw error;
      } else if (docType === 'weekly' && parsedWeeklyData) {
        const { error } = await supabase.from('weekly_practices').upsert({
          week_number: docNumber,
          topic_title: parsedWeeklyData.topic_title,
          fill_blanks_data: parsedWeeklyData.fill_blanks_data,
          synonym_data: parsedWeeklyData.synonym_data,
          reading_passage: parsedWeeklyData.reading_passage,
          tfng_data: parsedWeeklyData.tfng_data,
          listening_speaking_data: parsedWeeklyData.listening_speaking_data,
          writing_prompt: parsedWeeklyData.writing_prompt,
          pdf_url: pdfUrl
        }, { onConflict: 'week_number' });
        if (error) throw error;
      }

      setPublishSuccess(true);
      setParsedData(null);
      setParsedWeeklyData(null);
      setPdfFile(null);
    } catch (err) {
      console.error(err);
      alert('Failed to publish. Make sure you updated the database schema and storage policies.');
    } finally {
      setIsPublishing(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none"></div>
        <div className="bg-white/[0.02] backdrop-blur-xl p-8 rounded-2xl border border-white/[0.05] shadow-2xl shadow-black/20 max-w-sm w-full text-center relative z-10">
          <div className="w-12 h-12 bg-white/5 border border-white/10 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Key className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Admin Access</h2>
          <p className="text-sm text-slate-400 mb-6">Enter the passcode to access the admin portal.</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            const correctPasscode = import.meta.env.VITE_ADMIN_PASSCODE || 'admin123';
            if (passcode === correctPasscode) {
              setIsAuthenticated(true);
            } else {
              alert('Incorrect passcode');
            }
          }}>
            <input 
              type="password" 
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
              placeholder="Passcode"
              className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-2 mb-4 focus:ring-2 focus:ring-indigo-500/50 outline-none text-white placeholder-slate-500 transition-all"
              autoFocus
            />
            <button type="submit" className="w-full bg-indigo-500 text-white font-medium py-2 rounded-lg hover:bg-indigo-600 shadow-lg shadow-indigo-500/20 transition-all">
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  const hasData = parsedData || parsedWeeklyData;

  return (
    <div className="space-y-6 relative z-10">
      <div className="flex flex-col md:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Admin Portal</h1>
          <p className="text-slate-400 mt-1">Upload IELTS PDFs to extract and publish interactive lessons.</p>
        </div>
        {!import.meta.env.VITE_GEMINI_API_KEY && (
          <div className="bg-white/[0.02] backdrop-blur-md p-3 rounded-xl border border-white/[0.05] shadow-lg shadow-black/10 flex items-center gap-3">
            <Key className="w-5 h-5 text-indigo-400" />
            <input 
              type="password" 
              placeholder="Gemini API Key"
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-sm w-64 p-1 outline-none text-white placeholder-slate-500"
            />
          </div>
        )}
      </div>

      {!hasData && !isParsing && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-3xl p-8 shadow-2xl shadow-black/20 text-center">
          <div className="flex justify-center gap-4 mb-8">
            <button 
              onClick={() => setDocType('daily')}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${docType === 'daily' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              <Calendar className="w-5 h-5" />
              Daily Lesson
            </button>
            <button 
              onClick={() => setDocType('weekly')}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${docType === 'weekly' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
            >
              <CalendarDays className="w-5 h-5" />
              Weekly Practice
            </button>
          </div>
          
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-12 transition-all ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/[0.1] hover:bg-white/[0.03]'}`}
          >
            <UploadCloud className={`w-14 h-14 mx-auto mb-6 ${isDragging ? 'text-indigo-400' : 'text-slate-400'}`} />
            <h3 className="text-xl font-semibold text-white">Drag & Drop {docType === 'daily' ? 'Daily Lesson' : 'Weekly Practice'} PDF</h3>
            <p className="text-sm text-slate-400 mt-2 mb-8">Make sure the PDF format matches the selected type.</p>
            <label className={`px-8 py-3 rounded-full font-medium transition-all shadow-lg ${apiKey ? 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600 shadow-indigo-500/25' : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/5'}`}>
              Select PDF File
              <input type="file" className="hidden" accept="application/pdf" onChange={handleFileChange} disabled={!apiKey} />
            </label>
            {!apiKey && <p className="text-xs text-rose-400 mt-4">Please enter your Gemini API key above to enable uploading.</p>}
          </div>
        </div>
      )}

      {isParsing && (
        <div className="flex flex-col items-center justify-center p-16 bg-white/[0.02] backdrop-blur-md rounded-3xl border border-white/[0.05] shadow-xl shadow-black/10">
          <Settings className="w-10 h-10 text-indigo-400 animate-spin mb-4" />
          <span className="text-lg font-medium text-slate-300">AI is analyzing {docType} PDF...</span>
        </div>
      )}

      {publishSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-5 rounded-2xl flex items-center shadow-[0_0_20px_rgba(16,185,129,0.1)] backdrop-blur-sm">
          <CheckCircle className="w-6 h-6 mr-3 text-emerald-400" />
          <span className="font-medium text-lg">{docType === 'daily' ? 'Daily Lesson' : 'Weekly Practice'} {docNumber} published successfully to Supabase!</span>
        </div>
      )}

      {hasData && !isParsing && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-3xl p-8 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/[0.05]">
            <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
              <div className="bg-indigo-500/20 p-2 rounded-xl text-indigo-400 border border-indigo-500/20">
                <FileText className="w-6 h-6" />
              </div>
              Parsed Preview ({docType === 'daily' ? 'Daily Lesson' : 'Weekly Practice'})
            </h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-400">{docType === 'daily' ? 'Day' : 'Week'} Number:</label>
                <input 
                  type="number" 
                  value={docNumber} 
                  onChange={(e) => setDocNumber(Number(e.target.value))}
                  className="bg-black/20 border border-white/10 text-white rounded-lg px-3 py-1.5 w-24 text-center focus:ring-2 focus:ring-indigo-500/50 outline-none"
                  min={1}
                />
              </div>
              <button 
                onClick={handlePublish}
                disabled={isPublishing}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none"
              >
                {isPublishing ? 'Publishing...' : 'Publish'}
              </button>
              <button 
                onClick={() => {
                  setParsedData(null);
                  setParsedWeeklyData(null);
                  setPdfFile(null);
                }}
                className="text-slate-400 hover:text-white font-medium px-4 py-2 rounded-full hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03] flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white mb-1">Attached PDF</h3>
                <p className="text-sm text-slate-400">{pdfFile ? pdfFile.name : 'No file attached'}</p>
              </div>
              {pdfFile && (
                <span className="text-xs font-medium bg-white/5 text-slate-300 px-3 py-1.5 rounded-lg border border-white/10">
                  {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
            </div>

            {/* Daily Lesson Preview */}
            {parsedData && (
              <>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Vocabulary ({parsedData.vocab_data.length} words)</h3>
                  <div className="max-h-40 overflow-y-auto space-y-2 text-sm pr-2 custom-scrollbar">
                    {parsedData.vocab_data.map((v, i) => (
                      <div key={i} className="flex gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors">
                        <span className="font-semibold text-indigo-400 w-28 shrink-0">{v.word}</span>
                        <span className="text-slate-400 truncate" title={v.definition}>{v.definition}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-2">Reading Passage Length</h3>
                  <p className="text-sm text-slate-400">{parsedData.reading_passage.length} characters extracted.</p>
                </div>
                
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">True/False/Not Given ({parsedData.tf_data.length} statements)</h3>
                  <div className="space-y-2 text-sm text-slate-300">
                    {parsedData.tf_data.map((tf, i) => (
                      <div key={i} className="flex gap-2 p-2 bg-white/5 rounded-lg border border-white/10">
                        <span className="w-4 text-slate-500 font-bold">{tf.id}.</span>
                        <span className="flex-1 text-slate-300">{tf.statement}</span>
                        <span className="font-semibold text-emerald-400">{tf.correct_answer}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Gamified MCQ ({parsedData.mcq_data.length} questions)</h3>
                  <div className="space-y-4 text-sm text-slate-300">
                    {parsedData.mcq_data.map((mcq, i) => (
                      <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/10">
                        <p className="font-medium text-white mb-3">{i + 1}. {mcq.question}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {mcq.options.map((opt, j) => (
                            <div key={j} className={`px-3 py-2 rounded-lg text-xs font-medium ${opt === mcq.correct_answer ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-black/20 text-slate-400 border border-white/5'}`}>
                              {opt}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Weekly Practice Preview */}
            {parsedWeeklyData && (
              <>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Topic Title</h3>
                  <p className="text-sm text-slate-400">{parsedWeeklyData.topic_title}</p>
                </div>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Fill-in-the-blanks ({parsedWeeklyData.fill_blanks_data.sentences.length} sentences)</h3>
                  <div className="mb-2 text-sm text-indigo-400">Word Bank: {parsedWeeklyData.fill_blanks_data.word_bank.join(', ')}</div>
                  <div className="space-y-2 text-sm text-slate-300">
                    {parsedWeeklyData.fill_blanks_data.sentences.map((s, i) => (
                      <div key={i}>
                        {i + 1}. {s.text_before} <span className="text-emerald-400 font-bold underline decoration-emerald-500/50">{s.answer}</span> {s.text_after}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Synonyms ({parsedWeeklyData.synonym_data.length} pairs)</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                    {parsedWeeklyData.synonym_data.map((s, i) => (
                      <div key={i} className="flex justify-between p-2 bg-white/5 rounded-lg border border-white/10">
                        <span className="font-semibold text-indigo-400">{s.target}</span>
                        <span className="text-slate-400">{s.synonym}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Reading & TFNG ({parsedWeeklyData.tfng_data.length} statements)</h3>
                  <p className="text-sm text-slate-400 mb-2">Passage: {parsedWeeklyData.reading_passage.length} characters</p>
                  <div className="space-y-1 text-sm text-slate-300">
                    {parsedWeeklyData.tfng_data.map((tf, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="w-4 text-slate-500">{tf.id}.</span>
                        <span className="flex-1 truncate">{tf.statement}</span>
                        <span className="font-semibold text-emerald-400">{tf.correct_answer}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
                  <h3 className="font-semibold text-white mb-3">Speaking & Writing</h3>
                  <div className="text-sm text-slate-300 mb-4">
                    <strong>Speaking Prompt:</strong> {parsedWeeklyData.listening_speaking_data.speaking_prompt}
                  </div>
                  <div className="text-sm text-slate-300">
                    <strong>Writing Prompt:</strong> {parsedWeeklyData.writing_prompt}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
