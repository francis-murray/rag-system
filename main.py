# Semantic search part inspired by 
# "Build a semantic search engine with LangChain" tutorial 
# (https://docs.langchain.com/oss/python/langchain/knowledge-base)

import os

from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter


def main():
    print("Hello from rag-system!\n")

    # Load environment variables
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your " \
            "environment .env file.")

    ###################################################
    ######## 1. Documents and document loaders ########
    ###################################################
    file_path = "./pdf_documents/GPT-4 Technical Report (small 3 pages).pdf"
    loader = PyPDFLoader(file_path)

    docs = loader.load()

    # PyPDFLoader loads one Document object per PDF page
    print(f"Number of pages in {file_path.split("/")[-1]}: {len(docs)}")


    # print the first 50 chars and metadata of the first 3 pages of the pdf
    # print()
    # for i in range(0, 3):
    #     print("=" * 50)
    #     print(f"\nPage {i+1}'s content first 200 chars: ")
    #     print(f"{docs[i].page_content[:200]}\n")

    #     print(f"Page {i+1}'s metadata: ")
    #     print(docs[i].metadata)


    # split our documents into chunks 
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=100, add_start_index=True
    )
    all_splits = text_splitter.split_documents(docs)
    print(f"Number of splits in {file_path.split("/")[-1]}: {len(all_splits)}")

    # print("First 5 chunks:")
    # for split in all_splits[:3]:
    #     print()
    #     print(split)


    ###################################################
    ########            2. Embeddings          ########
    ###################################################
    embeddings = OpenAIEmbeddings(model="text-embedding-3-large")

    vector_1 = embeddings.embed_query(all_splits[0].page_content)
    vector_2 = embeddings.embed_query(all_splits[1].page_content)

    assert len(vector_1) == len(vector_2)

    print(f"Generated vectors of length {len(vector_1)}\n")
    print("First 10 dimensions of the embedding vector:")
    print(vector_1[:10])


if __name__ == "__main__":
    main()
