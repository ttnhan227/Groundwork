import os

# Hosted API tests never connect to the user's live Supabase database.
os.environ['DATABASE_URL'] = 'sqlite://'
os.environ['ENVIRONMENT'] = 'development'
os.environ['JWT_SECRET'] = 'test-only-cloud-secret-with-at-least-32-characters'
