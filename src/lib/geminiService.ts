import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { ParsedLesson } from './pdfParser';

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
