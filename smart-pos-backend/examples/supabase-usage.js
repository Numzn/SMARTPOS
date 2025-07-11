// Example usage of Supabase client
import { supabase } from './lib/supabase.js'

// Example: Query data
async function getUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
  
  if (error) {
    console.error('Error:', error)
    return null
  }
  
  return data
}

// Example: Insert data
async function createUser(userData) {
  const { data, error } = await supabase
    .from('users')
    .insert([userData])
    .select()
  
  if (error) {
    console.error('Error:', error)
    return null
  }
  
  return data
}

export { getUsers, createUser }
