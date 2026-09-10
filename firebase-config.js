// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================
// 1. Crie um projeto grátis em https://console.firebase.google.com
// 2. Ative "Firestore Database" (modo produção) e, em Authentication > Sign-in
//    method, ative o provedor "Anônimo".
// 3. Em Configurações do projeto > Geral > Seus apps, registre um app Web
//    e cole aqui embaixo as chaves que o Firebase te der.
//
// Essas chaves NÃO são segredo — é normal (e seguro) que fiquem no código do
// site. Quem protege os dados são as regras do arquivo firestore.rules.
// Veja o README.md para o passo a passo completo.
// ============================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCZ9XAyxRNqNxs4z2ERjgxW4OIdMFAlNjE",
  authDomain: "poker-league-d507f.firebaseapp.com",
  projectId: "poker-league-d507f",
  storageBucket: "poker-league-d507f.firebasestorage.app",
  messagingSenderId: "1029442063909",
  appId: "1:1029442063909:web:b4f1adcf95ac763caeb9cc",
};
