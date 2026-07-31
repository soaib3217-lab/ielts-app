-- Enable the pgcrypto extension for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table: daily_lessons
CREATE TABLE daily_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_number INTEGER UNIQUE NOT NULL,
    topic_title TEXT,
    vocab_data JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {word, level, definition, example}
    reading_passage TEXT,
    tf_data JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {id, statement, correct_answer}
    mcq_data JSONB NOT NULL DEFAULT '[]'::jsonb, -- Pre-generated Array of {question, options, correct_index}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Table: user_progress
CREATE TABLE user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- simple anonymous browser UUID
    lesson_id UUID REFERENCES daily_lessons(id) ON DELETE CASCADE,
    points_earned INTEGER DEFAULT 0,
    mcq_completed BOOLEAN DEFAULT false,
    tf_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, lesson_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE daily_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_lessons
-- 1. Allow public read access to lessons
CREATE POLICY "Allow public read access to lessons" 
ON daily_lessons FOR SELECT 
USING (true);

-- 2. Allow authenticated admin (or open for prototype) insert/update. 
-- For a strict prototype without auth, we can allow open inserts, but ideally restricted.
CREATE POLICY "Allow anon insert to lessons (Prototype)" 
ON daily_lessons FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow anon update to lessons (Prototype)" 
ON daily_lessons FOR UPDATE 
USING (true);

-- RLS Policies for user_progress
-- 1. Users can read their own progress
CREATE POLICY "Users can read their own progress"
ON user_progress FOR SELECT
USING (true);

-- 2. Users can insert their own progress
CREATE POLICY "Users can insert their own progress"
ON user_progress FOR INSERT
WITH CHECK (true);

-- 3. Users can update their own progress
CREATE POLICY "Users can update their own progress"
ON user_progress FOR UPDATE
USING (true);
