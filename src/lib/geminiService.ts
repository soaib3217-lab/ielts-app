import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ParsedLesson, ParsedWeeklyPractice } from './pdfParser';

export interface SpeakingEvaluation {
  transcription: string;
  fluency_and_coherence: { score: number; feedback: string };
  lexical_resource: { score: number; feedback: string };
  grammatical_range: { score: number; feedback: string };
  pronunciation: { score: number; feedback: string };
  overall_band: number;
  key_strengths: string[];
  areas_for_improvement: string[];
}

export async function extractDataWithGemini(rawText: string, apiKey: string): Promise<ParsedLesson> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Define the JSON schema we want Gemini to return
  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      topic_title: {
        type: SchemaType.STRING,
        description: "The topic or title of the practice lesson."
      },
      reading_passage: {
        type: SchemaType.STRING,
        description: "The full text of the Reading passage."
      },
      vocab_data: {
        type: SchemaType.ARRAY,
        description: "List of extracted vocabulary words.",
        items: {
          type: SchemaType.OBJECT,
          properties: {
            word: { type: SchemaType.STRING },
            level: { type: SchemaType.STRING, description: "e.g., C1/C2" },
            definition: { 
              type: SchemaType.STRING, 
              description: "The English definition AND the Bengali meaning in brackets. VERY IMPORTANT: Fix any broken Bengali unicode characters caused by PDF extraction (e.g. '7নরুংসা7হিত' should be fixed to 'নিরুৎসাহিত', 'ক=ঠার' to 'কঠোর')." 
            },
            example: { type: SchemaType.STRING, description: "The example sentence for the word." }
          },
          required: ["word", "level", "definition", "example"]
        }
      },
      tf_data: {
        type: SchemaType.ARRAY,
        description: "List of True/False/Not Given statements.",
        items: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.INTEGER },
            statement: { type: SchemaType.STRING },
            correct_answer: { type: SchemaType.STRING, description: "True, False, or Not Given" }
          },
          required: ["id", "statement", "correct_answer"]
        }
      },
      mcq_data: {
        type: SchemaType.ARRAY,
        description: "List of generated Fill-in-the-blank multiple choice questions based on the vocabulary.",
        items: {
          type: SchemaType.OBJECT,
          properties: {
            question: { 
              type: SchemaType.STRING,
              description: "Take the example sentence for a vocab word, replace the vocab word with a blank line '_________'. Example: 'The police are committed to reducing violent _________ in the city.'"
            },
            options: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description: "An array of exactly 4 strings. One is the correct vocab word, the other 3 are distractors from the rest of the vocabulary list."
            },
            correct_index: {
              type: SchemaType.INTEGER,
              description: "The index (0-3) of the correct answer in the options array."
            }
          },
          required: ["question", "options", "correct_index"]
        }
      }
    },
    required: ["topic_title", "reading_passage", "vocab_data", "tf_data", "mcq_data"]
  } as any;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.2, // Low temperature for factual extraction
    }
  });

  const prompt = `
You are an expert IELTS instructor and a master at fixing corrupted Bengali typography.
You are given raw, messy text extracted from a PDF. 
Your job is to parse it perfectly into the requested JSON structure.

CRITICAL INSTRUCTIONS:
1. Extract the 10 daily vocabulary words. The raw text has English definitions and Bengali meanings.
2. The Bengali meanings might be heavily corrupted by PDF.js extracting a legacy font (e.g., it might say "[োেনরুংসোহিত করা / বাধা ‡দেওয়া]" instead of "[নিরুৎসাহিত করা / বাধা দেওয়া]", or "[ক=ঠার]" instead of "[কঠোর]"). You MUST fix the Bengali spelling contextually and return perfect Unicode Bengali in the 'definition' field (e.g., "Excessively harsh [অত্যন্ত কঠোর]").
3. Extract the Reading passage.
4. Extract the True/False/Not Given statements and their answers.
5. GENERATE MCQs: For each vocabulary word, take its example sentence, replace the word with a blank, and provide 4 options (the correct word + 3 distractors from the list).

Raw Text from PDF:
---
${rawText}
---
`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  
  if (!responseText) {
    throw new Error("Failed to generate response from Gemini");
  }

  const parsedLesson: ParsedLesson = JSON.parse(responseText);
  
  // Programmatically shuffle the MCQ options to ensure random distribution
  parsedLesson.mcq_data = parsedLesson.mcq_data.map(mcq => {
    const correctAnswer = mcq.options[mcq.correct_index];
    const shuffledOptions = [...mcq.options].sort(() => 0.5 - Math.random());
    const newCorrectIndex = shuffledOptions.indexOf(correctAnswer);
    
    return {
      ...mcq,
      options: shuffledOptions,
      correct_index: newCorrectIndex
    };
  });

  return parsedLesson;
}

export async function extractWeeklyDataWithGemini(rawText: string, apiKey: string): Promise<ParsedWeeklyPractice> {
  const genAI = new GoogleGenerativeAI(apiKey);

  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      topic_title: { type: SchemaType.STRING, description: "The title of the weekly practice (e.g., 'Phase 1: Foundation Building | Week 2 Review')" },
      fill_blanks_data: {
        type: SchemaType.OBJECT,
        properties: {
          word_bank: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "The words in the Word Bank" },
          sentences: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                text_before: { type: SchemaType.STRING, description: "Text before the blank" },
                blank: { type: SchemaType.STRING, description: "The blank placeholder, e.g. '________'" },
                text_after: { type: SchemaType.STRING, description: "Text after the blank" },
                answer: { type: SchemaType.STRING, description: "The correct word from the word bank that fills the blank" }
              },
              required: ["text_before", "blank", "text_after", "answer"]
            }
          }
        },
        required: ["word_bank", "sentences"]
      },
      synonym_data: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            target: { type: SchemaType.STRING, description: "Target Word" },
            synonym: { type: SchemaType.STRING, description: "The synonym (e.g., 'Rapid increase / Spread')" }
          },
          required: ["target", "synonym"]
        }
      },
      reading_passage: { type: SchemaType.STRING, description: "The full text of the Reading passage" },
      tfng_data: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.INTEGER },
            statement: { type: SchemaType.STRING },
            correct_answer: { type: SchemaType.STRING, description: "True, False, or Not Given" }
          },
          required: ["id", "statement", "correct_answer"]
        }
      },
      listening_speaking_data: {
        type: SchemaType.OBJECT,
        properties: {
          listening_instructions: { type: SchemaType.STRING, description: "The listening task source and instructions" },
          speaking_prompt: { type: SchemaType.STRING, description: "The main speaking prompt (e.g. Describe a historical building...)" },
          speaking_bullet_points: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "The 'You should say:' bullet points" }
        },
        required: ["listening_instructions", "speaking_prompt", "speaking_bullet_points"]
      },
      writing_prompt: { type: SchemaType.STRING, description: "The writing journal entry prompt" }
    },
    required: ["topic_title", "fill_blanks_data", "synonym_data", "reading_passage", "tfng_data", "listening_speaking_data", "writing_prompt"]
  } as any;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.1,
    }
  });

  const prompt = `
You are an expert IELTS instructor.
You are given raw, messy text extracted from a Weekly Practice PDF. 
Your job is to parse it perfectly into the requested JSON structure.

CRITICAL INSTRUCTIONS:
1. Extract the topic title (e.g., "Phase 1: Foundation Building | Week X Review").
2. Fill in the Blanks: Extract the word bank. For each sentence, figure out which word fits the blank. Split the sentence into 'text_before', 'blank', and 'text_after'.
3. Synonym Matching: Match the Target Word with its correct synonym based on the text.
4. Active Reading: Extract the reading passage and the True/False/Not Given questions. Figure out the correct answers from the text.
5. Listening & Speaking: Extract the listening instructions, speaking prompt, and bullet points.
6. Writing: Extract the writing journal prompt.

Raw Text from PDF:
---
\${rawText}
---
`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  
  if (!responseText) {
    throw new Error("Failed to generate response from Gemini");
  }

  const parsedWeekly: ParsedWeeklyPractice = JSON.parse(responseText);
  return parsedWeekly;
}

export async function evaluateSpeakingPractice(
  audioBase64: string,
  mimeType: string,
  promptText: string,
  bulletPoints: string[],
  apiKey: string
): Promise<SpeakingEvaluation> {
  const genAI = new GoogleGenerativeAI(apiKey);

  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      transcription: { type: SchemaType.STRING, description: "The exact transcript of what the user said in the audio." },
      fluency_and_coherence: {
        type: SchemaType.OBJECT,
        properties: {
          score: { type: SchemaType.NUMBER, description: "IELTS band score (0-9)" },
          feedback: { type: SchemaType.STRING, description: "Detailed feedback on fluency, flow, and coherence." }
        },
        required: ["score", "feedback"]
      },
      lexical_resource: {
        type: SchemaType.OBJECT,
        properties: {
          score: { type: SchemaType.NUMBER, description: "IELTS band score (0-9)" },
          feedback: { type: SchemaType.STRING, description: "Detailed feedback on vocabulary usage, collocations, and range." }
        },
        required: ["score", "feedback"]
      },
      grammatical_range: {
        type: SchemaType.OBJECT,
        properties: {
          score: { type: SchemaType.NUMBER, description: "IELTS band score (0-9)" },
          feedback: { type: SchemaType.STRING, description: "Detailed feedback on grammatical accuracy and variety of sentence structures." }
        },
        required: ["score", "feedback"]
      },
      pronunciation: {
        type: SchemaType.OBJECT,
        properties: {
          score: { type: SchemaType.NUMBER, description: "IELTS band score (0-9)" },
          feedback: { type: SchemaType.STRING, description: "Detailed feedback on pronunciation, intonation, and clarity." }
        },
        required: ["score", "feedback"]
      },
      overall_band: { type: SchemaType.NUMBER, description: "The overall average IELTS speaking band score (0-9)." },
      key_strengths: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "2-3 short bullet points on what they did well." },
      areas_for_improvement: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "2-3 short bullet points on what they should improve." }
    },
    required: [
      "transcription",
      "fluency_and_coherence",
      "lexical_resource",
      "grammatical_range",
      "pronunciation",
      "overall_band",
      "key_strengths",
      "areas_for_improvement"
    ]
  } as any;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.2,
    }
  });

  const prompt = `
You are an expert IELTS Speaking Examiner. 
Listen to the provided audio recording of a student responding to the following speaking prompt:

PROMPT:
"${promptText}"
They were asked to cover these points:
${bulletPoints.map(b => "- " + b).join("\n")}

Evaluate the student's performance strictly according to the official IELTS speaking band descriptors.
Identify their exact words to generate a transcription, then grade their Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, and Pronunciation.
Provide constructive, direct, and actionable feedback.
  `;

  // Provide the base64 audio in inlineData format for Gemini API
  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        data: audioBase64,
        mimeType: mimeType
      }
    }
  ]);

  const responseText = result.response.text();
  if (!responseText) {
    throw new Error("Failed to evaluate speaking practice.");
  }

  const evaluation: SpeakingEvaluation = JSON.parse(responseText);
  return evaluation;
}
