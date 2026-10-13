import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AiBriefingController } from './ai-briefing.controller';
import { AiBriefingService } from './ai-briefing.service';
import { MakeBriefingDto } from './dto/make-briefing.dto';

const PERMISSIONS_KEY = 'permissions';

describe('AiBriefingController (ACC-198)', () => {
  const service = { read: jest.fn().mockResolvedValue({}), make: jest.fn().mockResolvedValue({}) };
  const controller = new AiBriefingController(service as unknown as AiBriefingService);
  // The decorated handler itself, where @Permissions() stores its metadata.
  const handler = (name: 'make' | 'read'): unknown => Object.getOwnPropertyDescriptor(AiBriefingController.prototype, name)?.value;

  it('POST needs tenant:manage_config; GET is self-scoped and needs nothing', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('make') as object)).toEqual(['tenant:manage_config']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('read') as object)).toBeUndefined();
  });

  it('passes the caller, the organisation and the language through', async () => {
    await controller.make('org-a', 'u1', ['tenant:manage_config'], { language: 'ar' });
    expect(service.make).toHaveBeenCalledWith({ id: 'u1', permissions: ['tenant:manage_config'] }, 'org-a', 'ar');
    await controller.read('org-a', 'u1', []);
    expect(service.read).toHaveBeenCalledWith({ id: 'u1', permissions: [] }, 'org-a');
  });

  it('the language is en or ar, nothing else', async () => {
    const errors = (body: unknown) => validate(plainToInstance(MakeBriefingDto, body));
    expect(await errors({ language: 'en' })).toHaveLength(0);
    expect(await errors({ language: 'ar' })).toHaveLength(0);
    expect(await errors({ language: 'fr' })).not.toHaveLength(0);
    expect(await errors({})).not.toHaveLength(0);
  });
});
