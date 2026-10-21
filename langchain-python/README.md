# langchain-aistupidlevel

A LangChain chat model for the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router.

Instead of a fixed model you pick a routing mode, such as `auto-coding`, `auto-reasoning`, `auto-tooling`, `auto-best` or `auto-value`. Each request goes to the model that scores best for that mode on AI Stupid Level's benchmarks, among the providers you connected (OpenAI, Anthropic, Google, DeepSeek, Kimi, GLM). The router calls that model with your own provider keys and adds nothing to token prices.

## Install

```sh
pip install -U langchain-aistupidlevel
export ASL_ROUTER_KEY="aism_..."   # https://aistupidlevel.info/router/keys
```

## Use

```python
from langchain_aistupidlevel import ChatAISL

llm = ChatAISL(model="auto-coding")
msg = llm.invoke("Write a Python function that reverses a string.")

print(msg.content)
print(msg.response_metadata["routed_model"])     # the model that answered, e.g. claude-opus-5-5
print(msg.response_metadata["routed_provider"])  # e.g. anthropic
print(msg.response_metadata["routing_reason"])   # why the router chose it
```

`ChatAISL` is built on `ChatOpenAI`, so tool calling (`bind_tools`), structured output (`with_structured_output`), streaming and async work the same way. A model id such as `claude-opus-5-5` instead of a routing mode pins that model.

**What it adds over `ChatOpenAI` with a base URL:** the router reports which model answered and why in response headers, which `ChatOpenAI` drops. `ChatAISL` copies them into `response_metadata` as `routed_model`, `routed_provider`, `routing_reason`, `routing_latency_ms` and `routing_request_id`.

### Sandbox

```python
llm = ChatAISL(model="auto-tooling", sandbox=True)
```

The routing is real and the answer is a mock: nothing is sent to a model or counted. It is useful for building and testing before you add provider keys.

## Configuration

| Parameter | Environment variable | Default |
|---|---|---|
| `api_key` | `ASL_ROUTER_KEY` | none |
| `base_url` | `ASL_BASE_URL` | `https://aistupidlevel.info/v1` |
| `model` | | `auto-best` |
| `sandbox` | | `False` |

The routing modes are described at https://aistupidlevel.info/router/docs#strategies. The router routes text and tool calls; image input is not supported.

## Development

```sh
pip install -e ".[test]"
pytest tests/unit_tests
ASL_ROUTER_KEY=aism_... pytest tests/integration_tests            # sandbox: nothing spent
ASL_ROUTER_KEY=aism_... ASL_LIVE=1 pytest tests/integration_tests # real models, with provider keys
```

MIT licence.
