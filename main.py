# Semantic search part inspired by 
# "Build a semantic search engine with LangChain" tutorial 
# (https://docs.langchain.com/oss/python/langchain/knowledge-base)

import os
import hashlib

from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma


def deterministic_chunk_id(document):
    metadata = document.metadata or {}
    source = metadata.get("source", "unknown_source")
    page = metadata.get("page", "unknown_page")
    start_index = metadata.get("start_index", "unknown_start")

    id_seed = f"{source}|{page}|{start_index}"
    # Keep IDs stable even if metadata is missing or duplicated.
    if "unknown_" in id_seed:
        content_hash = hashlib.sha256(document.page_content.encode("utf-8")).hexdigest()[:16]
        id_seed = f"{id_seed}|{content_hash}"

    return hashlib.sha256(id_seed.encode("utf-8")).hexdigest()


def main():

    # size of initial set of retrieved chunks
    k = 5

    print("Hello from rag-system!\n")

    # Load environment variables
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your " \
            "environment .env file.")


    ###################################################
    ########            1. INDEXING            ########
    ###################################################

    
    ######## 1.1 Documents and document loaders ########
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


    ################ 1.2 Embeddings  ################
    embeddings = OpenAIEmbeddings(model="text-embedding-3-large")

    vector_1 = embeddings.embed_query(all_splits[0].page_content)
    vector_2 = embeddings.embed_query(all_splits[1].page_content)

    assert len(vector_1) == len(vector_2)

    print(f"Generated vectors of length {len(vector_1)}\n")
    # print("First 10 dimensions of the embedding vector:")
    # print(vector_1[:10])


    ################ 1.3 Vector Store ################
    # instantiate vector store
    vector_store = Chroma(
        collection_name="documents_collection",
        embedding_function=embeddings,
        persist_directory="./chroma_langchain_db",
    )

    # index the documents
    document_ids = [deterministic_chunk_id(doc) for doc in all_splits]
    vector_store.add_documents(documents=all_splits, ids=document_ids)


    ###################################################
    ########           2. RAG CHAIN            ########
    ###################################################
    print("=" * 50)

    # transform the vector store into a retriever for easier usage in chain
    query = input("Please enter your query: ")

    # 2.1 vector based semantic search
    base_retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k" : k} # initial candidate pool
    )


    candidate_chunks = base_retriever.invoke(query)
    
    print(f"\nCandidate chunks (k={k}):")
    for candidate_chunk in candidate_chunks:
        print()
        print(f"chunk id: {candidate_chunk.id}")
        print(candidate_chunk.page_content)
        print()
        print("-" * 50)


if __name__ == "__main__":
    main()
