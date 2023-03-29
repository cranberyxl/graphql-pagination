const { ApolloServer } = require("@apollo/server");
const gql = require("graphql-tag");
const { ArrayDataSource, dataSourcePager, OffsetDataSourceWrapper } = require("@graphql-pagination/core");
const { typeDefs: scalarTypeDefs, resolvers: scalarResolvers } = require("graphql-scalars");
const { GraphQLError } = require("graphql");

// generate 100 books { id : x, title: "Book x", published: "2022-01-01T14:17:11.929Z" }
const january = new Date("2022-01-01");
const createBook = (i) => {
    return {
        id: i + 1,
        title: `Book ${i + 1}`,
        author: `Author ${(i + 1) % 10}`,
        published: new Date(january.setDate(i + 1)),
    };
};
const books = Array.from(Array(100)).map((e, i) => createBook(i));
// Filter is applied only in booksByTitle query
const filter = (books, args) => {
    if (args.title) return books.filter(b => b.title === args.title);
    if (args.author) return books.filter(b => b.author === args.author);
    return books;
};
// Validation input args functions
const validateTitle = (args) => {
    if (args.title && !books.find(b => b.title === args.title)) throw new GraphQLError(`Title ${args.title} not exists`, { extensions: { code: "BAD_USER_INPUT" } });
};
const validateAuthor = (args) => {
    if (args.author && !books.find(b => b.author === args.author)) throw new GraphQLError(`Author ${args.author} not exists`, { extensions: { code: "BAD_USER_INPUT" } });
};

// create data source directly or via async function
// const ds = new ArrayDataSource(async () => books, "id", filter);
const ds = new ArrayDataSource(books, "id", filter);
const pagerById = dataSourcePager({
    dataSource: ds,
    typeName: "Book",
    validateForwardArgs: [validateAuthor, validateTitle],
    validateBackwardArgs: [validateAuthor, validateTitle],
    typeDefDirectives: {
        pageInfo: "@cacheControl(inheritMaxAge: true)",
        connection: "@cacheControl(inheritMaxAge: true)",
        edge: "@cacheControl(inheritMaxAge: true)",
    },
});

const dsPublished = new ArrayDataSource(books, "published");
const pagerPublished = dataSourcePager({ dataSource: dsPublished, typeName: "Book" });

/* Offset Pager */
class ArrayOffsetDs extends ArrayDataSource {

    async after(offset, size, args) {
    // No field data comparison involved. It's just offset slicing
        return this.getNodes(args).then(data => data.slice(offset, offset + size));
    }

}

const dsOffset = new ArrayOffsetDs(books, "_NOT_USED_");
const pagerOffset = dataSourcePager({
    dataSource: new OffsetDataSourceWrapper(dsOffset),
    typeName: "Book",
});

// Functional way
const pagerDynamicDS = dataSourcePager();

// BookConnection is generated by dataSourcePager
const typeDefs = gql`
    enum CacheControlScope {
        PUBLIC
        PRIVATE
    }
    directive @cacheControl(
        maxAge: Int
        scope: CacheControlScope
        inheritMaxAge: Boolean
    ) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION
    
    type Book @cacheControl(inheritMaxAge: true) {
        id: ID!
        title: String
        author: String
        published: DateTime
    }
    type Query {
        booksAsc(first: Int = 10 after: String): BookConnection  @cacheControl(maxAge: 60)
        booksDesc(last: Int = 10 before: String): BookConnection @cacheControl(maxAge: 60)
        booksPublishedAsc(first: Int = 10 after: String): BookConnection    @cacheControl(maxAge: 10)
        booksPublishedDesc(last: Int = 10 before: String): BookConnection   @cacheControl(maxAge: 10)
        booksByTitle(first: Int = 10 after: String title: String): BookConnection
        booksByAuthor(first: Int = 10 after: String author: String): BookConnection

        booksByOffset(first: Int = 10 after: String): BookConnection

        booksDynamic(first: Int = 10 after: String): BookConnection
    }
`;

const resolvers = {
    Query: {
        booksAsc: (_, args, { pagerDataloader }) => pagerDataloader.forwardResolver(args),
        booksDesc: (_, args, { pagerDataloader }) => pagerDataloader.backwardResolver(args),
        booksPublishedAsc: (_, args) => pagerPublished.forwardResolver(args),
        booksPublishedDesc: (_, args) => pagerPublished.backwardResolver(args),
        booksByTitle: (_, args) => pagerById.forwardResolver(args),
        booksByAuthor: (_, args) => pagerById.forwardResolver(args),

        booksByOffset: (_, args) => pagerOffset.forwardResolver(args),

        booksDynamic: (_, args) => pagerDynamicDS.forwardResolver(args, new ArrayDataSource(books)),
    },
};

const createApolloServer = () => {
    return new ApolloServer({
        typeDefs: [
            typeDefs,
            pagerById.typeDef().ConnectionType, // or pagerById.typeDefs to get them all
            pagerById.typeDef().EdgeType,
            pagerById.typeDef().PageInfoType,
            scalarTypeDefs, // for DateTime
        ],
        resolvers: [
            resolvers,
            scalarResolvers, // for DateTime
        ],
    });
};

module.exports = {
    createApolloServer,
    dataSource: ds,
};
