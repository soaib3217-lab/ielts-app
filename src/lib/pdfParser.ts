import * as pdfjsLib from 'pdfjs-dist';

// Configure the worker for pdfjs-dist via a CDN matching the installed version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface ParsedLesson {
  topic_title: string;
  vocab_data: { word: string; level: string; definition: string; example: string }[];
  reading_passage: string;
  tf_data: { id: number; statement: string; correct_answer: string }[];
  mcq_data: { question: string; options: string[]; correct_index: number }[];
  pdf_url?: string;
}

export async function extractRawTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }

  return fullText;
}
