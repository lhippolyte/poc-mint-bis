import express from "express";
import bodyParser from "body-parser";

const app = express();

const port = process.env.PORT || 4000 

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.post("/fmd-request", async (req, res) => {
  try {
    console.log("REQ BODY:", req.body);
    console.log("REQ QUERY:", req.query);

    const enterprise = req.query.enterprise;
    const email = req.body.email;

    if (!enterprise || !email) {
      return res.status(400).send("Paramètres manquants");
    }

    // 1) Récupérer le métaobjet entreprise
    const enterpriseData = await getEnterprise(enterprise);
    if (!enterpriseData) {
      return res.status(404).send("Entreprise introuvable");
    }

    // 2) Lire les demandes existantes
    const requests = enterpriseData.access_requests || [];

    // 3) Ajouter une nouvelle demande
    requests.push({
      email,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    // 4) Mettre à jour le métaobjet
    await updateEnterprise(enterpriseData.id, {
      access_requests: JSON.stringify(requests),
    });

    // 5) Envoi de l’email employeur
    await sendEmailToEmployer({
      to: enterpriseData.employer_email,
      employee: email,
      enterprise: enterpriseData.name,
    });

    // 6) Réponse simple
    return res.send(`
      <h2>Demande envoyée</h2>
      <p>Votre demande a bien été transmise à votre employeur.</p>
    `);

  } catch (err) {
    console.error(err);
    return res.status(500).send("Erreur serveur");
  }
});


// ---------------- HELPER SHOPIFY GRAPHQL -----------------

async function shopifyGraphQL(query, variables = {}) {
  const endpoint = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/graphql.json`;

  console.log("Shopify GraphQL endpoint:", endpoint);
  console.log("Shopify GraphQL process.env.SHOPIFY_ADMIN_API_TOKEN:", process.env.SHOPIFY_ADMIN_API_TOKEN);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables
    }),
  });

  const json = await res.json();

  if (json.errors) {
    console.error("GraphQL Errors:", json.errors);
  }

  return json.data;
}



async function getEnterprise(slug) {
  const query = `
    {
      metaobject(handle: {type: "enterprise", handle: "${slug}"}) {
        id
        fields {
          key
          value
        }
      }
    }
  `;

  const response = await shopifyGraphQL(query);
  if (!response.metaobject) return null;

  const obj = {};
  for (const f of response.metaobject.fields) {
    obj[f.key] = JSON.parseOrString(f.value);
  }

  obj.id = response.metaobject.id;
  return obj;
}



async function updateEnterprise(id, fields) {
  const mutation = `
    mutation UpdateEnterprise($id: ID!, $fields: [MetaobjectFieldInput!]!) {
      metaobjectUpdate(id: $id, metaobject: {fields: $fields}) {
        metaobject { id }
      }
    }
  `;

  const formattedFields = Object.entries(fields).map(([k, v]) => ({
    key: k,
    value: v,
  }));

  await shopifyGraphQL(mutation, {
    id,
    fields: formattedFields,
  });
}


import sgMail from "@sendgrid/mail";
sgMail.setApiKey(process.env.SENDGRID_KEY);

async function sendEmailToEmployer({ to, employee, enterprise }) {
  await sgMail.send({
    to,
    from: "no-reply@mintbikes.com",
    subject: "Nouvelle demande FMD",
    html: `
      <p>Un employé souhaite accéder au FMD :</p>
      <p><strong>${employee}</strong></p>
      <p>Entreprise : ${enterprise}</p>
      <p>Gérer les demandes :</p>
      <a href="https://mint-bikes.com/apps/employer?enterprise=${enterprise}">
         Ouvrir le dashboard
      </a>
    `,
  });
}
