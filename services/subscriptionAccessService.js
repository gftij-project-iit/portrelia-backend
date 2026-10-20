const { db } = require("../config/db");

/*
 * Récupère le plan actif d'une entreprise.
 */
const getCompanyPlan = async (companyId) => {
  if (!companyId) {
    return null;
  }

  const result = await db.query(
    `
    SELECT
      cs.id AS "subscriptionId",
      cs.status AS "subscriptionStatus",

      p.id AS "planId",
      p.code AS "planCode",
      p.name AS "planName",

      p.max_active_campaigns AS "maxActiveCampaigns",
      p.max_participants_per_campaign AS "maxParticipantsPerCampaign",
      p.max_portraits_per_month AS "maxPortraitsPerMonth",

      p.all_styles AS "allStyles",
      p.hd_download AS "hdDownload",
      p.zip_export AS "zipExport",
      p.custom_branding AS "customBranding",
      p.priority_support AS "prioritySupport"

    FROM company_subscriptions cs
    INNER JOIN plans p
      ON p.id = cs.plan_id

    WHERE cs.company_id = $1
      AND cs.status = 'ACTIVE'
      AND p.is_active = TRUE

    LIMIT 1
    `,
    [companyId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

/*
 * Vérifie si l'entreprise peut créer une nouvelle campagne.
 */
const canCreateCampaign = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  if (!plan) {
    return {
      allowed: false,
      reason: "NO_SUBSCRIPTION",
      message: "Vous devez choisir une offre avant de créer une campagne.",
    };
  }

  const result = await db.query(
    `
    SELECT COUNT(*)::INTEGER AS count
    FROM campaigns
    WHERE company_id = $1
      AND status NOT IN ('COMPLETED', 'CANCELLED')
    `,
    [companyId]
  );

  const current = result.rows[0].count;

  if (
    plan.maxActiveCampaigns !== null &&
    current >= plan.maxActiveCampaigns
  ) {
    return {
      allowed: false,
      reason: "CAMPAIGN_LIMIT_REACHED",
      message: "Vous avez atteint la limite de campagnes actives de votre offre.",
      current,
      limit: plan.maxActiveCampaigns,
    };
  }

  return {
    allowed: true,
    current,
    limit: plan.maxActiveCampaigns,
    plan,
  };
};

/*
 * Vérifie le nombre de participants lors de la création
 * d'une nouvelle campagne.
 */
const canCreateCampaignWithParticipants = async (
  companyId,
  participantsCount
) => {
  const plan = await getCompanyPlan(companyId);

  if (!plan) {
    return {
      allowed: false,
      reason: "NO_SUBSCRIPTION",
      message: "Vous devez choisir une offre avant de créer une campagne.",
    };
  }

  if (
    plan.maxParticipantsPerCampaign !== null &&
    participantsCount > plan.maxParticipantsPerCampaign
  ) {
    return {
      allowed: false,
      reason: "PARTICIPANT_LIMIT_REACHED",
      message: "Le nombre de collaborateurs dépasse la limite autorisée par votre offre.",
      current: 0,
      requested: participantsCount,
      limit: plan.maxParticipantsPerCampaign,
    };
  }

  return {
    allowed: true,
    current: 0,
    requested: participantsCount,
    limit: plan.maxParticipantsPerCampaign,
    plan,
  };
};

/*
 * Vérifie si de nouveaux participants peuvent être
 * ajoutés à une campagne existante.
 */
const canAddParticipants = async (
  companyId,
  campaignId,
  participantsToAdd = 1
) => {
  const plan = await getCompanyPlan(companyId);

  if (!plan) {
    return {
      allowed: false,
      reason: "NO_SUBSCRIPTION",
      message: "Vous devez choisir une offre avant d'ajouter des collaborateurs.",
    };
  }

  const campaignResult = await db.query(
    `
    SELECT id
    FROM campaigns
    WHERE id = $1
      AND company_id = $2
    LIMIT 1
    `,
    [campaignId, companyId]
  );

  if (campaignResult.rows.length === 0) {
    return {
      allowed: false,
      reason: "CAMPAIGN_NOT_FOUND",
      message: "Campagne introuvable.",
    };
  }

  const participantResult = await db.query(
    `
    SELECT COUNT(*)::INTEGER AS count
    FROM participants
    WHERE campaign_id = $1
    `,
    [campaignId]
  );

  const current = participantResult.rows[0].count;
  const futureTotal = current + participantsToAdd;

  if (
    plan.maxParticipantsPerCampaign !== null &&
    futureTotal > plan.maxParticipantsPerCampaign
  ) {
    return {
      allowed: false,
      reason: "PARTICIPANT_LIMIT_REACHED",
      message: "La limite de collaborateurs autorisée par votre offre serait dépassée.",
      current,
      requested: participantsToAdd,
      limit: plan.maxParticipantsPerCampaign,
    };
  }

  return {
    allowed: true,
    current,
    requested: participantsToAdd,
    futureTotal,
    limit: plan.maxParticipantsPerCampaign,
    plan,
  };
};

const canUseAllStyles = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  return {
    allowed: Boolean(plan?.allStyles),
    reason: plan ? null : "NO_SUBSCRIPTION",
    plan,
  };
};

const canDownloadHd = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  return {
    allowed: Boolean(plan?.hdDownload),
    reason: plan ? null : "NO_SUBSCRIPTION",
    plan,
  };
};

const canExportZip = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  return {
    allowed: Boolean(plan?.zipExport),
    reason: plan ? null : "NO_SUBSCRIPTION",
    plan,
  };
};

const canUseCustomBranding = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  return {
    allowed: Boolean(plan?.customBranding),
    reason: plan ? null : "NO_SUBSCRIPTION",
    plan,
  };
};

const hasPrioritySupport = async (companyId) => {
  const plan = await getCompanyPlan(companyId);

  return {
    allowed: Boolean(plan?.prioritySupport),
    reason: plan ? null : "NO_SUBSCRIPTION",
    plan,
  };
};

module.exports = {
  getCompanyPlan,
  canCreateCampaign,
  canCreateCampaignWithParticipants,
  canAddParticipants,
  canUseAllStyles,
  canDownloadHd,
  canExportZip,
  canUseCustomBranding,
  hasPrioritySupport,
};