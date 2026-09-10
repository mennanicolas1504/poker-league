import { db, authReady, doc, getDoc, setDoc, serverTimestamp } from "./firebase-init.js";

const log = (msg) => {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
};

document.getElementById("btn-importar").addEventListener("click", async () => {
  document.getElementById("btn-importar").disabled = true;
  log("Conectando ao Firebase…");
  try {
    await authReady;
    const resp = await fetch("./seed.json");
    const seed = await resp.json();

    log(`Encontradas ${seed.etapas.length} etapas no seed.json.`);

    let criadas = 0;
    let puladas = 0;

    for (const etapa of seed.etapas) {
      const ref = doc(db, "etapas", etapa.date);
      const existente = await getDoc(ref);
      if (existente.exists()) {
        puladas++;
        log(`- ${etapa.date}: já existe, pulei.`);
        continue;
      }
      await setDoc(ref, {
        date: etapa.date,
        results: etapa.results,
        updatedAt: serverTimestamp(),
      });
      criadas++;
      log(`- ${etapa.date}: importada (${etapa.results.length} jogadores).`);
    }

    const premioRef = doc(db, "config", "premiacao");
    const premioSnap = await getDoc(premioRef);
    if (!premioSnap.exists()) {
      await setDoc(premioRef, { valor: seed.premiacao });
      log(`Premiação inicial definida: R$ ${seed.premiacao}.`);
    } else {
      log("Premiação já configurada, não mexi.");
    }

    log(`\nPronto! ${criadas} etapas importadas, ${puladas} já existiam.`);
    log("Pode voltar para o index.html — a classificação já vai estar lá.");
  } catch (err) {
    console.error(err);
    log("\nDeu erro: " + err.message);
    log("Confira firebase-config.js e as regras do Firestore.");
  }
});
