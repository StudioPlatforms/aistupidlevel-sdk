"""The AI Stupid Level Smart Router in Langflow.

When Langflow starts, its extension loader reads the ``extension.json`` next to this file. It
registers the **AI Stupid Level** model provider (Settings → Model Providers, and the model picker
of the Language Model and Agent components) and loads the ``aistupidlevel`` bundle, which holds the
**AI Stupid Level** component.

This module stays free of imports so that Langflow can load :mod:`lfx_aistupidlevel.discovery`
cheaply.
"""

__version__ = "0.1.0"
