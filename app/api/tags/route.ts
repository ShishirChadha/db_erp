import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch all activities for this user, extract tags
  const { data, error } = await supabase
    .from('activities')
    .select('tags')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Collect unique tags
  const tagSet = new Set<string>();
  data?.forEach(activity => {
    activity.tags?.forEach((tag: string) => tagSet.add(tag));
  });
  const uniqueTags = Array.from(tagSet).sort();

  return NextResponse.json(uniqueTags);
}