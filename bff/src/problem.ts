import type { FastifyReply } from 'fastify';

export interface ProblemDetailsBody {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
}

export async function sendProblem(reply: FastifyReply, p: ProblemDetailsBody): Promise<void> {
  reply
    .code(p.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .send(JSON.stringify(p));
}
