/**
 * GET /api/staff/verifications/[id]/photo — фото студенческого билета
 * из ПРИВАТНОГО хранилища (storage/, вне webroot, без публичных ссылок).
 *
 * Безопасность потока:
 * - Content-Type — из mime, вычисленного по расширению файла (БД хранит
 *   только относительный путь внутри хранилища);
 * - Cache-Control: no-store — фото персональных данных не кешируется;
 * - Content-Disposition: inline — показ в интерфейсе очереди;
 * - путь из БД клиенту НЕ отдаётся никогда: в ответе только буфер;
 * - faculty-scope: чужой факультет → 404 (обобщённый ответ);
 * - каждый просмотр пишется в аудит (verification.photo_view).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getStaffVerificationPhoto } from '@udgu/core';
import { pathParam } from '@/lib/http';
import { coreErrorResponse, requireSession } from '@/lib/session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const verificationId = pathParam(id, 'заявки на верификацию');
    const session = await requireSession(request);
    const { buffer, mime } = await getStaffVerificationPhoto(session, verificationId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    return coreErrorResponse(error);
  }
}
