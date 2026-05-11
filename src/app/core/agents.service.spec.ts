// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AgentsService } from './agents.service';
import { environment } from '../../environments/environment';

const BASE = environment.orchestratorBaseUrl;

let agents: AgentsService;
let httpMock: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  agents = TestBed.inject(AgentsService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
});

describe('AgentsService.list', () => {
  it('issues GET /api/v1/agents and decodes the Agent[] body', () => {
    let result: unknown;
    agents.list().subscribe((a) => (result = a));
    const req = httpMock.expectOne(`${BASE}/api/v1/agents`);
    expect(req.request.method).toBe('GET');
    req.flush({
      data: [
        {
          ref: 'lifecycle-agent@0.3.0',
          description: 'Drives a feature lifecycle from work item to merged implementation.',
          nodes: [
            { name: 'load_work_item', kind: 'local' },
            { name: 'request_implementation', kind: 'human' },
          ],
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
    expect(result).toEqual([
      {
        ref: 'lifecycle-agent@0.3.0',
        description: 'Drives a feature lifecycle from work item to merged implementation.',
        nodes: [
          { name: 'load_work_item', kind: 'local' },
          { name: 'request_implementation', kind: 'human' },
        ],
      },
    ]);
  });
});
