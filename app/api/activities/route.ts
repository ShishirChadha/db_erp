import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status');
  const tag = searchParams.get('tag');
  const dueFrom = searchParams.get('due_from');
  const dueTo = searchParams.get('due_to');
  const remindFrom = searchParams.get('remind_from');
  const search = searchParams.get('search');
  // Sorting parameters (default: entry_date descending)
  const sortBy = searchParams.get('sort_by') || 'created_at';
  const sortOrder = searchParams.get('sort_order') === 'asc' ? true : false; // true = ascending, false = descending

  let query = supabase.from('activities').select('*').eq('user_id', user.id);

  // Filters
  if (statusParam && statusParam !== 'all') {
    const statusArray = statusParam.split(',');
    query = query.in('status', statusArray);
  }
  if (tag) query = query.contains('tags', [tag]);
  if (dueFrom) query = query.gte('due_date', dueFrom);
  if (dueTo) query = query.lte('due_date', dueTo);
  if (remindFrom) query = query.gte('reminder_at', remindFrom);
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

  // Apply sorting – map frontend column names to database columns
  const columnMap: Record<string, string> = {
    'title': 'title',
    'tags': 'tags',      // tags is an array – sorting might not work perfectly; you could keep default
    'status': 'status',
    'due_date': 'due_date',
    'reminder_at': 'reminder_at',
    'entry_date': 'created_at'
  };
  const dbColumn = columnMap[sortBy] || 'created_at';
  query = query.order(dbColumn, { ascending: sortOrder, nullsFirst: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { error } = await supabase.from('activities').insert({ ...body, user_id: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}