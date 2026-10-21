import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf8');
const lines = envContent.split(/\r?\n/);
let url = '';
let key = '';
for (const line of lines) {
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
    url = line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  }
  if (line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) {
    key = line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  }
}

const supabase = createClient(url, key);

async function inspect() {
  const { data: docs, error: docErr } = await supabase.from('documents').select('id, name, status, page_count');
  console.log('Docs count:', docs ? docs.length : 0, 'Error:', docErr);
  if (docs) {
    for (const d of docs) {
      console.log('Document:', d.id, d.name, d.status, d.page_count);
      const { data: chunks, error: chunkErr } = await supabase
        .from('document_chunks')
        .select('id, document_id, chunk_index, page_number, content')
        .eq('document_id', d.id)
        .order('chunk_index', { ascending: true });
      console.log('  Chunks for', d.name, ':', chunks ? chunks.length : 0, 'error:', chunkErr);
      if (chunks) {
        chunks.forEach((c, i) => {
          console.log(`   [Chunk ${i}] id=${c.id} p.${c.page_number} len=${c.content.length}`);
          console.log(`       content: ${JSON.stringify(c.content.slice(0, 120))}`);
        });
      }
    }
  }
}
inspect();
