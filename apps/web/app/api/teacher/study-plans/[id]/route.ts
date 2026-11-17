/**
 * DELETE /api/teacher/study-plans/[id] — удаление своего учебного плана
 * (BRIEF v2 §5).
 *
 * Владение: чужой или несуществующий план → 404 (packages/core,
 * NOT_OWNER): ответ не отличается от «не существует», поэтому перебором
 * идентификаторов чужие планы не найти. Файл из приватного хранилища
 * удаляет сервис вместе с записью в БД.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deleteStudyPlan } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    const planId = pathParam(id, 'плана');
    await deleteStudyPlan(session, planId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
