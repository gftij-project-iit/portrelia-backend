BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* =========================================================
   TYPES
========================================================= */

CREATE TYPE user_role AS ENUM (
  'ADMIN',
  'COMPANY_ADMIN'
);

CREATE TYPE demo_request_status AS ENUM (
  'PENDING',
  'CONTACTED',
  'ACCEPTED',
  'REJECTED'
);

CREATE TYPE company_status AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED'
);

CREATE TYPE campaign_status AS ENUM (
  'DRAFT',
  'READY',
  'IN_PROGRESS',
  'QA',
  'DELIVERY_READY',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE participant_status AS ENUM (
  'INVITED',
  'CONSENT_PENDING',
  'PHOTOS_PENDING',
  'PHOTOS_RECEIVED',
  'GENERATION_PENDING',
  'GENERATION_IN_PROGRESS',
  'QA_PENDING',
  'GALLERY_READY',
  'VALIDATED',
  'REVISION_REQUESTED',
  'DELIVERED'
);

CREATE TYPE invitation_status AS ENUM (
  'PENDING',
  'SENT',
  'OPENED',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE photo_status AS ENUM (
  'UPLOADED',
  'ACCEPTED',
  'REJECTED'
);

CREATE TYPE generation_status AS ENUM (
  'QUEUED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE portrait_status AS ENUM (
  'GENERATED',
  'QA_PENDING',
  'QA_APPROVED',
  'QA_REJECTED',
  'RETOUCH_REQUIRED',
  'PUBLISHED',
  'SELECTED',
  'DELIVERED'
);

CREATE TYPE qa_decision AS ENUM (
  'APPROVE',
  'REJECT',
  'REGENERATE',
  'RETOUCH'
);

CREATE TYPE retouch_status AS ENUM (
  'TODO',
  'IN_PROGRESS',
  'DONE',
  'CANCELLED'
);

CREATE TYPE delivery_status AS ENUM (
  'PREPARING',
  'READY',
  'DOWNLOADED',
  'ARCHIVED'
);

CREATE TYPE deletion_status AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'REJECTED'
);

/* =========================================================
   USERS
========================================================= */

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,

  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT,

  role user_role NOT NULL,

  company_id BIGINT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  activation_token_hash TEXT,
  activation_token_expires_at TIMESTAMPTZ,

  last_login_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   DEMO REQUESTS
========================================================= */

CREATE TABLE demo_requests (
  id BIGSERIAL PRIMARY KEY,

  company_name VARCHAR(255) NOT NULL,

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,

  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),

  team_size VARCHAR(50),

  message TEXT,

  consent_to_contact BOOLEAN NOT NULL DEFAULT FALSE,

  status demo_request_status NOT NULL DEFAULT 'PENDING',

  handled_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  handled_at TIMESTAMPTZ,

  internal_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   COMPANIES
========================================================= */

CREATE TABLE companies (
  id BIGSERIAL PRIMARY KEY,

  name VARCHAR(255) NOT NULL,

  billing_email VARCHAR(255),
  phone VARCHAR(50),

  employee_count INTEGER,
  employee_size_range VARCHAR(50),

  website_url TEXT,

  status company_status NOT NULL DEFAULT 'ACTIVE',

  source_demo_request_id BIGINT UNIQUE
    REFERENCES demo_requests(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT companies_employee_count_check
    CHECK (
      employee_count IS NULL
      OR employee_count >= 0
    )
);

ALTER TABLE users
ADD CONSTRAINT users_company_fk
FOREIGN KEY (company_id)
REFERENCES companies(id)
ON DELETE CASCADE;

ALTER TABLE users
ADD CONSTRAINT users_role_company_check
CHECK (
  (
    role = 'ADMIN'
    AND company_id IS NULL
  )
  OR
  (
    role = 'COMPANY_ADMIN'
    AND company_id IS NOT NULL
  )
);

/* =========================================================
   PORTRAIT STYLES
========================================================= */

CREATE TABLE portrait_styles (
  id BIGSERIAL PRIMARY KEY,

  name VARCHAR(120) NOT NULL UNIQUE,
  slug VARCHAR(120) NOT NULL UNIQUE,

  description TEXT,

  prompt_template TEXT,

  preview_image_url TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   CAMPAIGNS
========================================================= */

CREATE TABLE campaigns (
  id BIGSERIAL PRIMARY KEY,

  company_id BIGINT NOT NULL
    REFERENCES companies(id)
    ON DELETE CASCADE,

  created_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  style_id BIGINT
    REFERENCES portrait_styles(id)
    ON DELETE SET NULL,

  name VARCHAR(255) NOT NULL,

  description TEXT,

  status campaign_status NOT NULL DEFAULT 'DRAFT',

  deadline_at TIMESTAMPTZ,

  is_pilot BOOLEAN NOT NULL DEFAULT FALSE,

  target_participant_count INTEGER,

  target_delay_hours INTEGER,

  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT campaigns_participant_count_check
    CHECK (
      target_participant_count IS NULL
      OR target_participant_count > 0
    ),

  CONSTRAINT campaigns_target_delay_check
    CHECK (
      target_delay_hours IS NULL
      OR target_delay_hours > 0
    )
);

/* =========================================================
   PARTICIPANTS
========================================================= */

CREATE TABLE participants (
  id BIGSERIAL PRIMARY KEY,

  campaign_id BIGINT NOT NULL
    REFERENCES campaigns(id)
    ON DELETE CASCADE,

  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,

  email VARCHAR(255) NOT NULL,

  job_title VARCHAR(150),

  status participant_status
    NOT NULL
    DEFAULT 'INVITED',

  invited_at TIMESTAMPTZ,
  photos_received_at TIMESTAMPTZ,
  gallery_ready_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT participants_campaign_email_unique
    UNIQUE (
      campaign_id,
      email
    )
);

/* =========================================================
   INVITATIONS
========================================================= */

CREATE TABLE invitations (
  id BIGSERIAL PRIMARY KEY,

  /*
   * Un participant possède une seule
   * invitation courante.
   *
   * Lors d'une relance, on met à jour
   * cette ligne au lieu d'en créer une
   * nouvelle.
   */
  participant_id BIGINT NOT NULL UNIQUE
    REFERENCES participants(id)
    ON DELETE CASCADE,

  /*
   * Token sécurisé envoyé dans le lien
   * d'invitation.
   *
   * PostgreSQL génère automatiquement
   * le token à la création.
   *
   * Lors d'une relance, le token pourra
   * être remplacé par un nouveau UUID.
   */
  token UUID NOT NULL
    DEFAULT gen_random_uuid()
    UNIQUE,

  status invitation_status
    NOT NULL
    DEFAULT 'PENDING',

  /*
   * Date d'expiration du lien.
   *
   * Elle correspond actuellement
   * à la deadline de la campagne.
   */
  expires_at TIMESTAMPTZ,

  /*
   * Suivi de l'envoi et de l'ouverture.
   */
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,

  /*
   * Nombre de relances effectuées
   * pour cette même invitation.
   */
  reminder_count INTEGER
    NOT NULL
    DEFAULT 0,

  last_reminder_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW(),

  CONSTRAINT invitations_reminder_count_check
    CHECK (
      reminder_count >= 0
    )
);

/* =========================================================
   CONSENTS
========================================================= */

CREATE TABLE participant_consents (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT NOT NULL UNIQUE
    REFERENCES participants(id)
    ON DELETE CASCADE,

  consent_version VARCHAR(50) NOT NULL,

  accepted BOOLEAN NOT NULL,

  accepted_at TIMESTAMPTZ,

  ip_address INET,

  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   INPUT PHOTOS
========================================================= */

CREATE TABLE input_photos (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT NOT NULL
    REFERENCES participants(id)
    ON DELETE CASCADE,

  storage_provider VARCHAR(50),

  storage_key TEXT NOT NULL,

  original_filename VARCHAR(255),

  mime_type VARCHAR(100),

  size_bytes BIGINT,

  width INTEGER,
  height INTEGER,

  status photo_status
    NOT NULL
    DEFAULT 'UPLOADED',

  rejection_reason TEXT,

  quality_score NUMERIC(5,4),

  face_detected BOOLEAN,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT input_photos_size_check
    CHECK (
      size_bytes IS NULL
      OR size_bytes >= 0
    ),

  CONSTRAINT input_photos_quality_check
    CHECK (
      quality_score IS NULL
      OR (
        quality_score >= 0
        AND quality_score <= 1
      )
    )
);

/* =========================================================
   GENERATION JOBS
========================================================= */

CREATE TABLE generation_jobs (
  id BIGSERIAL PRIMARY KEY,

  campaign_id BIGINT NOT NULL
    REFERENCES campaigns(id)
    ON DELETE CASCADE,

  participant_id BIGINT NOT NULL
    REFERENCES participants(id)
    ON DELETE CASCADE,

  style_id BIGINT
    REFERENCES portrait_styles(id)
    ON DELETE SET NULL,

  provider VARCHAR(100) NOT NULL,

  provider_job_id VARCHAR(255),

  status generation_status
    NOT NULL
    DEFAULT 'QUEUED',

  attempt_number INTEGER
    NOT NULL
    DEFAULT 1,

  cost_amount NUMERIC(12,4),

  cost_currency CHAR(3)
    NOT NULL
    DEFAULT 'EUR',

  started_at TIMESTAMPTZ,

  completed_at TIMESTAMPTZ,

  error_code VARCHAR(100),

  error_message TEXT,

  request_payload JSONB,

  response_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT generation_attempt_check
    CHECK (
      attempt_number > 0
    ),

  CONSTRAINT generation_cost_check
    CHECK (
      cost_amount IS NULL
      OR cost_amount >= 0
    )
);

/* =========================================================
   GENERATED PORTRAITS
========================================================= */

CREATE TABLE generated_portraits (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT NOT NULL
    REFERENCES participants(id)
    ON DELETE CASCADE,

  generation_job_id BIGINT
    REFERENCES generation_jobs(id)
    ON DELETE SET NULL,

  storage_provider VARCHAR(50),

  storage_key TEXT NOT NULL,

  status portrait_status
    NOT NULL
    DEFAULT 'GENERATED',

  is_gallery_visible BOOLEAN
    NOT NULL
    DEFAULT FALSE,

  is_selected_by_participant BOOLEAN
    NOT NULL
    DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   QA REVIEWS
========================================================= */

CREATE TABLE qa_reviews (
  id BIGSERIAL PRIMARY KEY,

  portrait_id BIGINT NOT NULL
    REFERENCES generated_portraits(id)
    ON DELETE CASCADE,

  reviewer_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  decision qa_decision NOT NULL,

  resemblance_ok BOOLEAN,

  artifacts_ok BOOLEAN,

  skin_tone_ok BOOLEAN,

  style_consistency_ok BOOLEAN,

  overall_quality_ok BOOLEAN,

  notes TEXT,

  review_duration_seconds INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT qa_duration_check
    CHECK (
      review_duration_seconds IS NULL
      OR review_duration_seconds >= 0
    )
);

/* =========================================================
   RETOUCH TASKS
========================================================= */

CREATE TABLE retouch_tasks (
  id BIGSERIAL PRIMARY KEY,

  portrait_id BIGINT NOT NULL
    REFERENCES generated_portraits(id)
    ON DELETE CASCADE,

  assigned_to_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  status retouch_status
    NOT NULL
    DEFAULT 'TODO',

  instructions TEXT,

  result_storage_key TEXT,

  started_at TIMESTAMPTZ,

  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   GALLERIES
========================================================= */

CREATE TABLE galleries (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT NOT NULL UNIQUE
    REFERENCES participants(id)
    ON DELETE CASCADE,

  public_token UUID NOT NULL
    DEFAULT gen_random_uuid()
    UNIQUE,

  published_at TIMESTAMPTZ,

  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE gallery_portraits (
  gallery_id BIGINT NOT NULL
    REFERENCES galleries(id)
    ON DELETE CASCADE,

  portrait_id BIGINT NOT NULL
    REFERENCES generated_portraits(id)
    ON DELETE CASCADE,

  sort_order INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (
    gallery_id,
    portrait_id
  )
);

/* =========================================================
   PARTICIPANT SELECTION
========================================================= */

CREATE TABLE participant_selections (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT NOT NULL
    REFERENCES participants(id)
    ON DELETE CASCADE,

  portrait_id BIGINT
    REFERENCES generated_portraits(id)
    ON DELETE SET NULL,

  is_favorite BOOLEAN
    NOT NULL
    DEFAULT FALSE,

  is_final_selection BOOLEAN
    NOT NULL
    DEFAULT FALSE,

  revision_requested BOOLEAN
    NOT NULL
    DEFAULT FALSE,

  revision_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (
    participant_id,
    portrait_id
  )
);

/* =========================================================
   DELIVERIES
========================================================= */

CREATE TABLE deliveries (
  id BIGSERIAL PRIMARY KEY,

  campaign_id BIGINT NOT NULL
    REFERENCES campaigns(id)
    ON DELETE CASCADE,

  prepared_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  status delivery_status
    NOT NULL
    DEFAULT 'PREPARING',

  zip_storage_key TEXT,

  manifest_storage_key TEXT,

  portrait_count INTEGER
    NOT NULL
    DEFAULT 0,

  ready_at TIMESTAMPTZ,

  downloaded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT deliveries_portrait_count_check
    CHECK (
      portrait_count >= 0
    )
);

/* =========================================================
   DELIVERY FILES
========================================================= */

CREATE TABLE delivery_files (
  id BIGSERIAL PRIMARY KEY,

  delivery_id BIGINT NOT NULL
    REFERENCES deliveries(id)
    ON DELETE CASCADE,

  participant_id BIGINT
    REFERENCES participants(id)
    ON DELETE SET NULL,

  portrait_id BIGINT
    REFERENCES generated_portraits(id)
    ON DELETE SET NULL,

  file_name VARCHAR(255) NOT NULL,

  format VARCHAR(50),

  storage_key TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   DELETION REQUESTS
========================================================= */

CREATE TABLE deletion_requests (
  id BIGSERIAL PRIMARY KEY,

  participant_id BIGINT
    REFERENCES participants(id)
    ON DELETE SET NULL,

  company_id BIGINT
    REFERENCES companies(id)
    ON DELETE SET NULL,

  requested_email VARCHAR(255),

  status deletion_status
    NOT NULL
    DEFAULT 'PENDING',

  reason TEXT,

  requested_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW(),

  completed_at TIMESTAMPTZ,

  handled_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  proof JSONB,

  CONSTRAINT deletion_requests_target_check
    CHECK (
      participant_id IS NOT NULL
      OR company_id IS NOT NULL
      OR requested_email IS NOT NULL
    )
);

/* =========================================================
   AUDIT LOGS
========================================================= */

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,

  actor_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  company_id BIGINT
    REFERENCES companies(id)
    ON DELETE SET NULL,

  entity_type VARCHAR(100) NOT NULL,

  entity_id BIGINT,

  action VARCHAR(120) NOT NULL,

  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* =========================================================
   INDEXES
========================================================= */

CREATE INDEX idx_users_company
ON users(company_id);

CREATE INDEX idx_users_role
ON users(role);

CREATE INDEX idx_demo_requests_status
ON demo_requests(status);

CREATE INDEX idx_demo_requests_email
ON demo_requests(email);

CREATE INDEX idx_campaigns_company
ON campaigns(company_id);

CREATE INDEX idx_campaigns_status
ON campaigns(status);

CREATE INDEX idx_participants_campaign
ON participants(campaign_id);

CREATE INDEX idx_participants_status
ON participants(status);

/*
 * Pas besoin d'index manuel sur :
 *
 * invitations.participant_id
 * invitations.token
 *
 * car les contraintes UNIQUE créent
 * déjà leurs propres index.
 */

CREATE INDEX idx_input_photos_participant
ON input_photos(participant_id);

CREATE INDEX idx_generation_jobs_campaign
ON generation_jobs(campaign_id);

CREATE INDEX idx_generation_jobs_participant
ON generation_jobs(participant_id);

CREATE INDEX idx_generation_jobs_status
ON generation_jobs(status);

CREATE INDEX idx_portraits_participant
ON generated_portraits(participant_id);

CREATE INDEX idx_portraits_status
ON generated_portraits(status);

CREATE INDEX idx_qa_reviews_portrait
ON qa_reviews(portrait_id);

CREATE INDEX idx_retouch_status
ON retouch_tasks(status);

CREATE INDEX idx_deliveries_campaign
ON deliveries(campaign_id);

CREATE INDEX idx_deletion_status
ON deletion_requests(status);

/* =========================================================
   UPDATED_AT
========================================================= */

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER demo_requests_updated_at
BEFORE UPDATE ON demo_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER companies_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER portrait_styles_updated_at
BEFORE UPDATE ON portrait_styles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER campaigns_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER participants_updated_at
BEFORE UPDATE ON participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

/*
 * Important :
 * le token, le statut et les dates
 * d'une invitation peuvent changer
 * lors d'une relance.
 */
CREATE TRIGGER invitations_updated_at
BEFORE UPDATE ON invitations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER generation_jobs_updated_at
BEFORE UPDATE ON generation_jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER generated_portraits_updated_at
BEFORE UPDATE ON generated_portraits
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER retouch_tasks_updated_at
BEFORE UPDATE ON retouch_tasks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER participant_selections_updated_at
BEFORE UPDATE ON participant_selections
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER deliveries_updated_at
BEFORE UPDATE ON deliveries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

/* =========================================================
   INITIAL PORTRAIT STYLES
========================================================= */

INSERT INTO portrait_styles (
  name,
  slug,
  description,
  sort_order
)
VALUES
(
  'Corporate clair',
  'corporate-clair',
  'Portrait professionnel lumineux et neutre.',
  1
),
(
  'Executive',
  'executive',
  'Portrait corporate sobre et premium.',
  2
),
(
  'Studio neutre',
  'studio-neutre',
  'Portrait homogène sur fond studio neutre.',
  3
),
(
  'Editorial',
  'editorial',
  'Portrait professionnel naturel et éditorial.',
  4
),
(
  'Moderne',
  'moderne',
  'Portrait professionnel contemporain.',
  5
);

COMMIT;