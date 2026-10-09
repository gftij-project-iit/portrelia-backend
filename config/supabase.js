const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket =
  process.env.SUPABASE_STORAGE_BUCKET;

console.log("=== SUPABASE CONFIG TEST ===");
console.log("SUPABASE_URL :", supabaseUrl);
console.log(
  "SUPABASE_SERVICE_ROLE_KEY présente :",
  Boolean(supabaseSecretKey)
);
console.log(
  "SUPABASE_STORAGE_BUCKET :",
  supabaseBucket
);

if (!supabaseUrl) {
  throw new Error(
    "SUPABASE_URL manquante dans le .env"
  );
}

if (!supabaseSecretKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY manquante dans le .env"
  );
}

if (!supabaseBucket) {
  throw new Error(
    "SUPABASE_STORAGE_BUCKET manquant dans le .env"
  );
}

const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const testSupabaseConnection = async () => {
  try {
    console.log(
      "Test connexion Supabase Storage..."
    );

    const { data, error } =
      await supabase.storage.listBuckets();

    if (error) {
      console.error(
        "Erreur Supabase Storage :",
        error
      );
      return false;
    }

    console.log(
      "Supabase Storage connecté"
    );

    console.log(
      "Buckets disponibles :",
      data.map((bucket) => bucket.name)
    );

    const bucketExists =
      data.some(
        (bucket) =>
          bucket.name === supabaseBucket
      );

    console.log(
      `Bucket "${supabaseBucket}" trouvé :`,
      bucketExists
    );

    return true;
  } catch (error) {
    console.error(
      "Erreur test Supabase :",
      error
    );

    return false;
  }
};

module.exports = {
  supabase,
  testSupabaseConnection,
};