INSERT INTO role (nome) VALUES
  ('admin_tenant'),
  ('recrutador'),
  ('gestor_vaga'),
  ('entrevistador'),
  ('psicologo_responsavel'),
  ('cliente_agencia'),
  ('candidato')
ON CONFLICT DO NOTHING;
