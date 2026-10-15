// Środowisko testów: lokalna baza z TEST_DATABASE_URL, bez prawdziwych kluczy modeli.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
process.env.TASKHUB_OWNER_EMAIL = "test@example.com";
process.env.TASKHUB_OWNER_NAME = "Test";
process.env.TASKHUB_SECRET = "sekret-testowy-o-dlugosci-32-znakow!!";
process.env.TASKHUB_PASSWORD = "haslo";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_PROVIDER;
