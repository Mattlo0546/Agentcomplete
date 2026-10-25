import httpx
from prompt_enhance_mcp import client


async def test_server_lifespan_reuses_and_closes_transport(monkeypatch):
    created = []
    real_client = httpx.AsyncClient

    def make_client(**kwargs):
        instance = real_client(
            **kwargs,
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"items": [], "total": 0})),
        )
        created.append(instance)
        return instance

    monkeypatch.setattr(client.httpx, "AsyncClient", make_client)
    async with client.backend_session():
        await client.search_knowledge("first")
        await client.search_knowledge("second")
        assert len(created) == 1
        assert not created[0].is_closed
    assert created[0].is_closed
    assert client._client is None
