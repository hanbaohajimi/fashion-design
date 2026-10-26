from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row


@contextmanager
def saver(settings, initialize=False):
    from langgraph.checkpoint.postgres import PostgresSaver

    with psycopg.connect(settings.database_url, autocommit=True, row_factory=dict_row) as connection:
        if initialize:
            connection.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {} ").format(sql.Identifier(settings.checkpoint_schema)))
        connection.execute(sql.SQL("SET search_path TO {}, public").format(sql.Identifier(settings.checkpoint_schema)))
        checkpointer = PostgresSaver(connection)
        if initialize:
            checkpointer.setup()
        else:
            exists = connection.execute("SELECT to_regclass(%s) AS name", (f"{settings.checkpoint_schema}.checkpoints",)).fetchone()
            if not exists["name"]:
                raise RuntimeError("CHECKPOINT_SCHEMA_NOT_INITIALIZED")
        yield checkpointer
