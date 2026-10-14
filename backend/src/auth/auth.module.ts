import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [PassportModule],
  // APP_GUARD makes the guard global: every route needs a bearer token unless marked @Public().
  providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
