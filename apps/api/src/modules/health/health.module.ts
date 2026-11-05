import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { Public } from '../../common/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: 'up', at: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ ok: false, db: 'down' });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
