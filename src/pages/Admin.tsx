import React, { useState, useCallback, useEffect } from 'react';
import { UploadCloud, CheckCircle, FileText, Settings, Key } from 'lucide-react';
import { extractRawTextFromPDF, type ParsedLesson } from '../lib/pdfParser';
import { extractDataWithGemini } from '../lib/geminiService';
import { supabase } from '../lib/supabase';

export default function Admin() {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedLesson | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [dayNumber, setDayNumber] = useState(1);
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
  }, [apiKey]);

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
    try {
      const rawText = await extractRawTextFromPDF(file);
      const data = await extractDataWithGemini(rawText, apiKey);
      setParsedData(data);
    } catch (err) {
      console.error(err);
      alert('Failed to parse PDF using Gemini AI. Check console for details.');
    } finally {
      setIsParsing(false);
    }
  };

  const handlePublish = async () => {
    if (!parsedData) return;
    setIsPublishing(true);
    try {
      let pdfUrl = null;
      if (pdfFile) {
        // Upload the PDF to Supabase Storage
        const fileExt = pdfFile.name.split('.').pop();
        const fileName = `day-${dayNumber}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('ielts-pdfs')
          .upload(fileName, pdfFile, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) throw uploadError;

        // Retrieve the public URL
        const { data: { publicUrl } } = supabase.storage
          .from('ielts-pdfs')
          .getPublicUrl(fileName);

        pdfUrl = publicUrl;
      }

      const { error } = await supabase.from('daily_lessons').upsert({
        day_number: dayNumber,
        topic_title: parsedData.topic_title,
        vocab_data: parsedData.vocab_data,
        reading_passage: parsedData.reading_passage,
        tf_data: parsedData.tf_data,
        mcq_data: parsedData.mcq_data,
        pdf_url: pdfUrl
      }, { onConflict: 'day_number' });

      if (error) throw error;
      setPublishSuccess(true);
      setParsedData(null);
      setPdfFile(null);
    } catch (err) {
      console.error(err);
      alert('Failed to publish lesson or upload PDF. Make sure you created the ielts-pdfs bucket and RLS policies.');
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
            // In a real production app, you'd use Supabase Auth. For this static site, a basic gate suffices.
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

  return (
    <div className="space-y-6 relative z-10">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Admin Portal</h1>
          <p className="text-slate-400 mt-1">Upload daily IELTS PDF practice sheets to extract and publish interactive lessons.</p>
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

      {!parsedData && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-3xl p-16 text-center transition-all ${isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-white/[0.1] bg-white/[0.02] hover:bg-white/[0.03] backdrop-blur-sm shadow-xl shadow-black/10'}`}
        >
          <UploadCloud className={`w-14 h-14 mx-auto mb-6 ${isDragging ? 'text-indigo-400' : 'text-slate-400'}`} />
          <h3 className="text-xl font-semibold text-white">Drag & Drop PDF here</h3>
          <p className="text-sm text-slate-400 mt-2 mb-8">or click to browse from your computer</p>
          <label className={`px-8 py-3 rounded-full font-medium transition-all shadow-lg ${apiKey ? 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600 shadow-indigo-500/25' : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/5'}`}>
            Select PDF File
            <input type="file" className="hidden" accept="application/pdf" onChange={handleFileChange} disabled={!apiKey} />
          </label>
          {!apiKey && <p className="text-xs text-rose-400 mt-4">Please enter your Gemini API key above to enable uploading.</p>}
        </div>
      )}

      {isParsing && (
        <div className="flex flex-col items-center justify-center p-16 bg-white/[0.02] backdrop-blur-md rounded-3xl border border-white/[0.05] shadow-xl shadow-black/10">
          <Settings className="w-10 h-10 text-indigo-400 animate-spin mb-4" />
          <span className="text-lg font-medium text-slate-300">AI is analyzing and structuring PDF...</span>
        </div>
      )}

      {publishSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-5 rounded-2xl flex items-center shadow-[0_0_20px_rgba(16,185,129,0.1)] backdrop-blur-sm">
          <CheckCircle className="w-6 h-6 mr-3 text-emerald-400" />
          <span className="font-medium text-lg">Lesson Day {dayNumber} published successfully to Supabase!</span>
        </div>
      )}

      {parsedData && !isParsing && (
        <div className="bg-white/[0.02] backdrop-blur-xl border border-white/[0.05] rounded-3xl p-8 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/[0.05]">
            <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
              <div className="bg-indigo-500/20 p-2 rounded-xl text-indigo-400 border border-indigo-500/20">
                <FileText className="w-6 h-6" />
              </div>
              Parsed Preview
            </h2>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-400">Day Number:</label>
                <input 
                  type="number" 
                  value={dayNumber} 
                  onChange={(e) => setDayNumber(Number(e.target.value))}
                  className="bg-black/20 border border-white/10 text-white rounded-lg px-3 py-1.5 w-24 text-center focus:ring-2 focus:ring-indigo-500/50 outline-none"
                  min={1}
                />
              </div>
              <button 
                onClick={handlePublish}
                disabled={isPublishing}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-full font-medium transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none"
              >
                {isPublishing ? 'Publishing...' : 'Publish Day\'s Lesson'}
              </button>
              <button 
                onClick={() => {
                  setParsedData(null);
                  setPdfFile(null);
                }}
                className="text-slate-400 hover:text-white font-medium px-4 py-2 rounded-full hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
              <h3 className="font-semibold text-white mb-3">Vocabulary ({parsedData.vocab_data.length} words)</h3>
              <div className="max-h-40 overflow-y-auto space-y-2 text-sm pr-2 custom-scrollbar">
                {parsedData.vocab_data.map((v, i) => (
                  <div key={i} className="flex gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors">
                    <span className="font-semibold text-indigo-400 w-28 shrink-0">{v.word} <span className="text-xs font-normal text-indigo-400/70 ml-1">({v.level})</span></span>
                    <span className="text-slate-400 truncate" title={v.definition}>{v.definition}</span>
                  </div>
                ))}
              </div>
            </div>

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

            <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
              <h3 className="font-semibold text-white mb-2">Reading Passage Length</h3>
              <p className="text-sm text-slate-400">{parsedData.reading_passage.length} characters extracted.</p>
            </div>

            <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
              <h3 className="font-semibold text-white mb-3">T/F/NG Statements ({parsedData.tf_data.length})</h3>
              <div className="max-h-40 overflow-y-auto space-y-2 text-sm pr-2">
                {parsedData.tf_data.map((tf, i) => (
                  <div key={i} className="flex gap-3 p-2 hover:bg-white/5 rounded-lg transition-colors">
                    <span className="font-medium text-slate-500 w-6 shrink-0">{tf.id}.</span>
                    <span className="text-slate-300 flex-1 truncate">{tf.statement}</span>
                    <span className={`font-semibold shrink-0 ${tf.correct_answer === 'True' ? 'text-emerald-400' : tf.correct_answer === 'False' ? 'text-rose-400' : 'text-slate-400'}`}>{tf.correct_answer}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="p-5 bg-black/20 rounded-2xl border border-white/[0.03]">
              <h3 className="font-semibold text-white mb-2">Generated MCQs ({parsedData.mcq_data.length})</h3>
              <p className="text-sm text-slate-400 mb-4">Algorithmic MCQs generated using extracted definitions as distractors.</p>
              <div className="max-h-64 overflow-y-auto space-y-4 text-sm pr-2">
                {parsedData.mcq_data.map((mcq, i) => (
                  <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/10">
                    <p className="font-medium text-slate-300 mb-3" dangerouslySetInnerHTML={{ __html: `${i + 1}. ` + mcq.question.replace(/\*\*(.*?)\*\*/, '<span class="text-indigo-400 font-bold">$1</span>') }} />
                    <ul className="space-y-1.5">
                      {mcq.options.map((opt, optIdx) => (
                        <li key={optIdx} className={`pl-3 border-l-2 py-0.5 ${optIdx === mcq.correct_index ? 'border-emerald-400 text-emerald-400 font-medium' : 'border-white/10 text-slate-400'}`}>
                          {String.fromCharCode(65 + optIdx)}. {opt}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
