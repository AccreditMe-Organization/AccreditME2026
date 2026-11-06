import { Module } from '@nestjs/common';
import { CommitteesModule } from '../committees/committees.module';
import { SetupHealthModule } from '../setup-health/setup-health.module';
import { UserModule } from '../user/user.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

// ACC-279 — Home's admin summary. A leaf: nothing imports it, so it closes no
// module cycle. Each part comes from the module that owns its data.
@Module({
  imports: [SetupHealthModule, UserModule, CommitteesModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
