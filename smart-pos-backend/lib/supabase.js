import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || 'https://mzmwybrqejohtcbtkziy.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  throw new Error('Missing SUPABASE_KEY environment variable')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
