import { supabase } from './supabase';
import { parseAdText } from './parser';
import type { Analysis } from './types';
import { z } from 'zod';
const schema = z.object({ engine: z.string(), realAI: z.boolean(), hypotheses: z.array(z.object({ code: z.enum(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']), quote: z.string().min(1), reason: z.string() })).max(6) });
export async function analyze(text: string, complexName: string): Promise<Analysis> {
  if (text.length > 20000) throw new Error('Максимум 20 000 символов');
  if (!supabase) {
    const parsed = parseAdText(text);
    return { engine: 'Локальный парсер RU/KZ (демо)', realAI: false, hypotheses: parsed.payment.flagged ? [{ code: 'R2', quote: parsed.payment.quotes[0], reason: 'Обнаружено платёжное предложение. Требуется решение аналитика.' }] : [] };
  }
  const { data, error } = await supabase.functions.invoke('analyze', { body: { text, complexName }, signal: AbortSignal.timeout(45000) });
  if (error) throw new Error(`AI-анализ недоступен: ${error.message}`);
  const result = schema.parse(data);
  if (result.hypotheses.some(h => !text.includes(h.quote))) throw new Error('Модель вернула цитату вне исходного текста');
  return result;
}
