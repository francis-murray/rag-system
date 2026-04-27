# Semantic search part inspired by 
# "Build a semantic search engine with LangChain" tutorial 
# (https://docs.langchain.com/oss/python/langchain/knowledge-base)

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


def main():
    print("Hello from rag-system!")

    ###################################################
    ######## 1. Documents and document loaders ########
    ###################################################
    file_path = "./pdf_documents/GPT-4 Technical Report.pdf"
    loader = PyPDFLoader(file_path)

    docs = loader.load()

    # PyPDFLoader loads one Document object per PDF page
    print(f"Number of pages in {file_path.split("/")[-1]}: {len(docs)}")


    # print extract of first 3 pages of the pdf
    # print()
    # for i in range(0, 3):
    #     print("=" * 50)
    #     print(f"\nPage {i+1}'s content first 200 chars: ")
    #     print(f"{docs[i].page_content[:200]}\n")

    #     print(f"Page {i+1}'s metadata: ")
    #     print(docs[i].metadata)


    # split our documents into chunks of 1000 characters with 200 characters 
    # of overlap between chunks. The overlap helps mitigate the possibility 
    # of separating a statement from important context related to it. 

    # recursively split the document using common separators like new lines
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500, chunk_overlap=100, add_start_index=True
    )
    all_splits = text_splitter.split_documents(docs)
    print(f"Number of splits in {file_path.split("/")[-1]}: {len(all_splits)}")

    print("First 5 splits:")
    for split in all_splits[:3]:
        print()
        print(split)



if __name__ == "__main__":
    main()
