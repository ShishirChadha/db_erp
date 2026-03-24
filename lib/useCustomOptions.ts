'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useCustomOptions(category: string) {
  const [options, setOptions] = useState<string[]>([])
  const supabase = createClient()

  useEffect(() => {
    supabase
      .from('custom_options')
      .select('value')
      .eq('category', category)
      .then(({ data }) => {
        if (data) setOptions(data.map(d => d.value))
      })
  }, [category])

  const addOption = async (value: string) => {
    const { error } = await supabase
      .from('custom_options')
      .insert([{ category, value }])
    if (!error) setOptions(prev => [...prev, value])
    return !error
  }

  return { options, addOption }
}