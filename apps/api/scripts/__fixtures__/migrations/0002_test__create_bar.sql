CREATE TABLE IF NOT EXISTS test_bar (id serial PRIMARY KEY, foo_id int REFERENCES test_foo(id));
