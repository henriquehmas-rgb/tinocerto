ALTER TABLE requisition ADD COLUMN vaga_afirmativa text CHECK (vaga_afirmativa IN ('pcd', 'aprendiz'));
