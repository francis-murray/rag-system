import os

from dotenv import load_dotenv


def load_and_validate_env() -> None:

    # Load environment variables
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it to your environment .env file."
        )