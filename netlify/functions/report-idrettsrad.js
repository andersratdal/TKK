const {
  data: activeBatches,
  error: batchError,
} = await supabase
  .from("skating_school_batches")
  .select(`
    id,
    name,
    status
  `)
  .eq("status", "Aktiv");

if (batchError) {
  console.error(
    "report-idrettsrad batches:",
    batchError
  );

  return json(500, {
    error: "Kunne ikke hente aktivt semester.",
  });
}

if (!activeBatches || activeBatches.length === 0) {
  return json(200, {
    success: true,
    semester: null,
    rows: [],
  });
}

if (activeBatches.length > 1) {
  return json(500, {
    error: "Det finnes flere aktive semester. Sett kun ett semester som Aktivt.",
  });
}

const activeBatch = activeBatches[0];
