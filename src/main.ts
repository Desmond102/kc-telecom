import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  const frontendUrl = process.env.FRONTEND_URL;
  if (process.env.NODE_ENV === 'production' && !frontendUrl) {
    throw new Error('FRONTEND_URL is required in production');
  }
  app.enableCors({ origin: frontendUrl ?? true });
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`KC TELECOM backend running on http://0.0.0.0:${port}/api/v1`);
}

bootstrap();
